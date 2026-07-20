/**
 * ClienteBD JULIOABE — API de consulta a MongoDB Atlas
 * Sirve también la UI web/PWA en / 
 */

"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

function resolveEnvPath() {
  const candidates = [
    path.join(__dirname, ".env"),
    path.join(process.cwd(), "api", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  if (process.resourcesPath) {
    candidates.unshift(path.join(process.resourcesPath, "env", ".env"));
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.unshift(path.join(process.env.PORTABLE_EXECUTABLE_DIR, ".env"));
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[0];
}

/** Busca claveclie.key (clave de acceso a la app) */
function resolveKeyPath() {
  const candidates = [
    path.join(__dirname, "claveclie.key"),
    path.join(process.cwd(), "api", "claveclie.key"),
    path.join(process.cwd(), "claveclie.key"),
  ];
  if (process.resourcesPath) {
    candidates.unshift(path.join(process.resourcesPath, "env", "claveclie.key"));
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.unshift(
      path.join(process.env.PORTABLE_EXECUTABLE_DIR, "claveclie.key")
    );
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function loadAppPassword() {
  const keyPath = resolveKeyPath();
  if (keyPath) {
    try {
      const raw = fs.readFileSync(keyPath, "utf8");
      const line = String(raw || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s && !s.startsWith("#"));
      if (line) {
        console.log(`[clientebd] clave: ${keyPath}`);
        return line;
      }
    } catch (err) {
      console.warn("[clientebd] no se pudo leer claveclie.key:", err.message);
    }
  }
  // Respaldo: variable de entorno (Render/VPS) o valor por defecto
  const fromEnv = String(process.env.APP_PASSWORD || "").trim();
  if (fromEnv) {
    console.log("[clientebd] clave: APP_PASSWORD (entorno)");
    return fromEnv;
  }
  console.warn("[clientebd] aviso: falta claveclie.key — use clave por defecto");
  return "julioabe2026";
}

const ENV_PATH = resolveEnvPath();
require("dotenv").config({ path: ENV_PATH, override: true });
console.log(`[clientebd] env: ${ENV_PATH}`);

const PORT = Number(process.env.PORT || 3080);
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "syncdbf";
const APP_PASSWORD = loadAppPassword();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();

/** Colecciones SyncDBF conocidas */
const TABLES = [
  { id: "sync_facturas", label: "FACTURAS", key: "F_NUM", dbf: "FACTURAS.DBF" },
  { id: "sync_anaventa", label: "ANAVENTA", key: "F_NUM", dbf: "ANAVENTA.DBF" },
  { id: "sync_ctactecc", label: "CTACTECC", key: "CLAVE", dbf: "CTACTECC.DBF" },
  { id: "sync_clientes", label: "CLIENTES", key: "C_NRO", dbf: "CLIENTES.DBF" },
  { id: "sync_articulo", label: "ARTICULO", key: "CODART", dbf: "ARTICULO.DBF" },
  { id: "sync_rubros", label: "RUBROS", key: "CODIGO", dbf: "RUBROS.DBF" },
];

const app = express();
app.set("trust proxy", 1);
if (CORS_ORIGIN && CORS_ORIGIN !== "*") {
  app.use(
    cors({
      origin: CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
    })
  );
} else {
  app.use(cors());
}
app.use(express.json({ limit: "2mb" }));

/** @type {import('mongodb').Db | null} */
let db = null;
/** @type {import('mongodb').MongoClient | null} */
let client = null;

const sessions = new Map(); // token -> { at }

function makeToken() {
  return (
    "cbd_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 12)
  );
}

function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  const tok = m ? m[1].trim() : "";
  if (!tok || !sessions.has(tok)) {
    return res.status(401).json({ ok: false, mensaje: "Sesion invalida" });
  }
  sessions.get(tok).at = Date.now();
  return next();
}

function tableMeta(id) {
  return TABLES.find((t) => t.id === id) || null;
}

async function ensureDb() {
  if (db) return db;
  if (!MONGODB_URI) throw new Error("Falta MONGODB_URI en api/.env");
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB);
  return db;
}

app.get("/api/health", async (_req, res) => {
  try {
    if (!MONGODB_URI) {
      return res.status(503).json({
        ok: false,
        mensaje: "Falta MONGODB_URI en api/.env",
        storage: "none",
      });
    }
    await ensureDb();
    await db.command({ ping: 1 });
    res.json({
      ok: true,
      service: "clientebd",
      version: "1.0.0",
      db: MONGODB_DB,
      storage: "mongodb",
      connected: true,
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      mensaje: String(err.message || err),
      storage: "none",
      connected: false,
    });
  }
});

app.post("/api/login", (req, res) => {
  const pass = String((req.body && req.body.password) || "").trim();
  if (!pass || pass.toLowerCase() !== APP_PASSWORD.toLowerCase()) {
    return res.status(401).json({ ok: false, mensaje: "Clave incorrecta" });
  }
  const token = makeToken();
  sessions.set(token, { at: Date.now() });
  res.json({ ok: true, token, app: "ClienteBD JULIOABE" });
});

app.post("/api/logout", auth, (req, res) => {
  const hdr = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (m) sessions.delete(m[1].trim());
  res.json({ ok: true });
});

app.get("/api/tables", auth, async (_req, res) => {
  try {
    const database = await ensureDb();
    const existing = new Set(
      (await database.listCollections().toArray()).map((c) => c.name)
    );
    const rows = [];
    for (const t of TABLES) {
      let count = 0;
      let exists = existing.has(t.id);
      if (exists) {
        count = await database.collection(t.id).countDocuments();
      }
      rows.push({ ...t, exists, count });
    }
    // colecciones sync_* extras
    for (const name of existing) {
      if (!name.startsWith("sync_")) continue;
      if (TABLES.some((t) => t.id === name)) continue;
      const count = await database.collection(name).countDocuments();
      rows.push({
        id: name,
        label: name.replace(/^sync_/, "").toUpperCase(),
        key: "",
        dbf: "",
        exists: true,
        count,
      });
    }
    res.json({ ok: true, tables: rows, database: MONGODB_DB });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

app.get("/api/tables/:id/docs", auth, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const database = await ensureDb();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const q = String(req.query.q || "").trim();
    const skip = (page - 1) * limit;

    const cols = await database.listCollections({ name: id }).toArray();
    if (!cols.length) {
      return res.status(404).json({ ok: false, mensaje: "Coleccion no encontrada" });
    }

    const col = database.collection(id);
    let filter = {};
    if (q) {
      const asNum = Number(q);
      filter = {
        $or: [
          { F_NUM: { $regex: q, $options: "i" } },
          { F_NOM: { $regex: q, $options: "i" } },
          { C_RSO: { $regex: q, $options: "i" } },
          { NOMBRE: { $regex: q, $options: "i" } },
          { CLAVE: { $regex: q, $options: "i" } },
          { DETALLE: { $regex: q, $options: "i" } },
          { CODBARRA: { $regex: q, $options: "i" } },
        ],
      };
      if (!Number.isNaN(asNum) && q.trim() !== "") {
        filter.$or.push(
          { C_NRO: asNum },
          { CODART: asNum },
          { CODIGO: asNum },
          { F_CLI: asNum }
        );
      }
    }

    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const meta = tableMeta(id);
    res.json({
      ok: true,
      table: meta || { id, label: id },
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      docs,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

app.get("/api/tables/:id/docs/:docId", auth, async (req, res) => {
  try {
    const { ObjectId } = require("mongodb");
    const database = await ensureDb();
    const id = String(req.params.id || "");
    const docId = String(req.params.docId || "");
    let _id;
    try {
      _id = new ObjectId(docId);
    } catch {
      return res.status(400).json({ ok: false, mensaje: "Id invalido" });
    }
    const doc = await database.collection(id).findOne({ _id });
    if (!doc) {
      return res.status(404).json({ ok: false, mensaje: "Documento no encontrado" });
    }
    res.json({ ok: true, doc });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

/** Acepta DD/MM/YYYY (británico) o YYYY-MM-DD → normaliza a YYYY-MM-DD */
function toIsoDate(value) {
  const s = String(value || "").trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return (
      String(yyyy).padStart(4, "0") +
      "-" +
      String(mm).padStart(2, "0") +
      "-" +
      String(dd).padStart(2, "0")
    );
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  return null;
}

function parseDateRange(query) {
  const desde = toIsoDate(query.desde);
  const hasta = toIsoDate(query.hasta);
  if (!desde || !hasta) {
    return { error: "Use fechas DD/MM/YYYY (desde / hasta)" };
  }
  if (desde > hasta) {
    return { error: "La fecha desde no puede ser mayor que hasta" };
  }
  return { desde, hasta };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

const anaventaMatch = (desde, hasta) => ({
  FECHA: { $gte: desde, $lte: hasta },
  $or: [{ ANULADA: { $ne: 1 } }, { ANULADA: { $exists: false } }],
});

/** Totales de ventas desde FACTURAS: pesos, IVA y neto gravado */
async function buildVentasResumen(database, desde, hasta) {
  const rows = await database
    .collection("sync_facturas")
    .aggregate([
      { $match: { F_FEC: { $gte: desde, $lte: hasta } } },
      {
        $group: {
          _id: null,
          totalPesos: { $sum: { $ifNull: ["$F_NET", 0] } },
          totalIva: {
            $sum: {
              $add: [{ $ifNull: ["$F_IVA1", 0] }, { $ifNull: ["$F_IVA2", 0] }],
            },
          },
          totalNetoGravado: {
            $sum: {
              $add: [
                { $ifNull: ["$F_SUB1", 0] },
                { $ifNull: ["$F_SUB2", 0] },
                { $ifNull: ["$F_SUB3", 0] },
              ],
            },
          },
          comprobantes: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const r = rows[0] || {};
  return {
    totalPesos: round2(r.totalPesos),
    totalIva: round2(r.totalIva),
    totalNetoGravado: round2(r.totalNetoGravado),
    comprobantes: r.comprobantes || 0,
  };
}

/**
 * Cantidades/kilos vendidos desde ANAVENTA, acumulados por código de rubro (campo RUBRO).
 * El nombre se toma de sync_rubros.CODIGO.
 */
async function buildCantidadesPorRubro(database, desde, hasta) {
  const porRubroRaw = await database
    .collection("sync_anaventa")
    .aggregate([
      { $match: anaventaMatch(desde, hasta) },
      {
        $group: {
          _id: "$RUBRO",
          kgs: { $sum: { $ifNull: ["$KGS", 0] } },
          cantidad: { $sum: 1 },
          // Importe = suma de PRECIO * KGS por cada línea
          importe: {
            $sum: {
              $multiply: [
                { $ifNull: ["$PRECIO", 0] },
                { $ifNull: ["$KGS", 0] },
              ],
            },
          },
        },
      },
      { $sort: { kgs: -1 } },
    ])
    .toArray();

  const rubrosDocs = await database
    .collection("sync_rubros")
    .find({})
    .project({ CODIGO: 1, NOMBRE: 1 })
    .toArray();
  const rubMap = new Map(rubrosDocs.map((r) => [Number(r.CODIGO), r.NOMBRE]));

  const rubros = porRubroRaw.map((r) => {
    const codigo = Number(r._id != null ? r._id : 0);
    return {
      rubro: codigo,
      nombre: rubMap.get(codigo) || "RUBRO " + codigo,
      kgs: round3(r.kgs),
      cantidad: r.cantidad || 0,
      importe: round2(r.importe),
    };
  });

  return {
    resumen: {
      rubros: rubros.length,
      kgs: round3(rubros.reduce((s, a) => s + a.kgs, 0)),
      cantidad: rubros.reduce((s, a) => s + a.cantidad, 0),
      importe: round2(rubros.reduce((s, a) => s + a.importe, 0)),
    },
    rubros,
  };
}

/** Primera y última fecha de facturas sincronizadas (para el almanaque) */
app.get("/api/reports/rango-fechas", auth, async (_req, res) => {
  try {
    const database = await ensureDb();
    const rows = await database
      .collection("sync_facturas")
      .aggregate([
        {
          $match: {
            F_FEC: { $type: "string", $ne: "" },
          },
        },
        {
          $group: {
            _id: null,
            primera: { $min: "$F_FEC" },
            ultima: { $max: "$F_FEC" },
            comprobantes: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const r = rows[0];
    if (!r || !r.primera || !r.ultima) {
      return res.json({
        ok: true,
        origen: "mongodb",
        database: MONGODB_DB,
        primera: null,
        ultima: null,
        comprobantes: 0,
      });
    }
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      primera: r.primera,
      ultima: r.ultima,
      comprobantes: r.comprobantes || 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// Totales de ventas por rango (FACTURAS)
app.get("/api/reports/ventas", auth, async (req, res) => {
  try {
    const range = parseDateRange(req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const database = await ensureDb();
    const resumen = await buildVentasResumen(database, desde, hasta);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      resumen,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// Cantidades/kilos por código de rubro (ANAVENTA.RUBRO)
app.get("/api/reports/articulos-rubros", auth, async (req, res) => {
  try {
    const range = parseDateRange(req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const database = await ensureDb();
    const data = await buildCantidadesPorRubro(database, desde, hasta);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      ...data,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// Alias: cantidades/kilos por rubro desde ANAVENTA
app.get("/api/reports/cantidades", auth, async (req, res) => {
  try {
    const range = parseDateRange(req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const database = await ensureDb();
    const data = await buildCantidadesPorRubro(database, desde, hasta);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      ...data,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

/** Período: ventas + cantidades por rubro */
app.get("/api/reports/periodo", auth, async (req, res) => {
  try {
    const range = parseDateRange(req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const database = await ensureDb();
    const [ventasResumen, cantidades] = await Promise.all([
      buildVentasResumen(database, desde, hasta),
      buildCantidadesPorRubro(database, desde, hasta),
    ]);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      ventas: { resumen: ventasResumen },
      cantidades,
      kilosRubros: cantidades,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// UI estatica
const webRoot = path.join(__dirname, "..", "web");
app.use(express.static(webRoot));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(webRoot, "index.html"));
});

async function start() {
  try {
    await ensureDb();
    console.log(`[mongo] conectado db=${MONGODB_DB}`);
  } catch (err) {
    console.warn("[mongo] aviso:", err.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[clientebd] local:  http://127.0.0.1:${PORT}`);
    if (PUBLIC_BASE_URL) {
      console.log(`[clientebd] publico: ${PUBLIC_BASE_URL}`);
      console.log(`[clientebd] instalar: ${PUBLIC_BASE_URL}/instalar-movil.html`);
    } else {
      console.log(
        `[clientebd] tip: defina PUBLIC_BASE_URL en api/.env para la URL fija del celular`
      );
    }
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
