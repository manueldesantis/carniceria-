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

function toBritishDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return m[3] + "/" + m[2] + "/" + m[1];
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

/** Normaliza F_FEC (string ISO, DD/MM/YYYY o Date) a YYYY-MM-DD */
function normalizeFecIso(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return toIsoDate(s) || (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
}

/**
 * Primera y última fecha de comprobantes en FACTURAS (sync_facturas / FACTURAS.DBF).
 * Cualquier consulta por rango debe quedar dentro de [primera, ultima].
 */
async function getFacturasFechaBounds(database) {
  const rows = await database
    .collection("sync_facturas")
    .aggregate([
      {
        $match: {
          F_FEC: { $exists: true, $nin: [null, ""] },
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
  if (!r) return null;
  const primera = normalizeFecIso(r.primera);
  const ultima = normalizeFecIso(r.ultima);
  if (!primera || !ultima) return null;
  return {
    primera,
    ultima,
    comprobantes: r.comprobantes || 0,
  };
}

/**
 * Valida rango libre dentro de FACTURAS:
 * primera <= desde <= hasta <= ultima
 */
async function parseDateRangeAgainstFacturas(database, query) {
  const range = parseDateRange(query);
  if (range.error) return range;

  const bounds = await getFacturasFechaBounds(database);
  if (!bounds) {
    return {
      error:
        "No hay comprobantes en FACTURAS para consultar. Sincronice FACTURAS.DBF.",
    };
  }

  const { primera, ultima } = bounds;
  if (range.desde < primera) {
    return {
      error:
        "La fecha Desde debe ser mayor o igual a la del primer comprobante de FACTURAS (" +
        toBritishDate(primera) +
        ")",
    };
  }
  if (range.hasta > ultima) {
    return {
      error:
        "La fecha Hasta debe ser menor o igual a la del último comprobante de FACTURAS (" +
        toBritishDate(ultima) +
        ")",
    };
  }
  if (range.desde > ultima || range.hasta < primera) {
    return {
      error:
        "El rango debe estar entre " +
        toBritishDate(primera) +
        " y " +
        toBritishDate(ultima) +
        " (FACTURAS)",
    };
  }

  return {
    desde: range.desde,
    hasta: range.hasta,
    primera,
    ultima,
    comprobantes: bounds.comprobantes,
  };
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

/** Convierte TIPOCOMP (char/num) a número para agrupar */
const tipocompNumExpr = {
  $convert: {
    input: {
      $trim: {
        input: { $toString: { $ifNull: ["$TIPOCOMP", "0"] } },
      },
    },
    to: "double",
    onError: 0,
    onNull: 0,
  },
};

/** Etiquetas AFIP habituales (código numérico TIPOCOMP) */
const TIPOCOMP_LABELS = {
  0: "Comprobante interno / sin fiscal",
  1: "Factura A",
  2: "Nota de débito A",
  3: "Nota de crédito A",
  4: "Recibo A",
  5: "Nota de venta al contado A",
  6: "Factura B",
  7: "Nota de débito B",
  8: "Nota de crédito B",
  9: "Recibo B",
  10: "Nota de venta al contado B",
  11: "Factura C",
  12: "Nota de débito C",
  13: "Nota de crédito C",
  15: "Recibo C",
  51: "Factura M",
  81: "Tique factura A",
  82: "Tique factura B",
  83: "Tique",
  111: "Factura de crédito electrónica A",
  112: "Nota de débito electrónica A",
  113: "Nota de crédito electrónica A",
};

function tipocompLabel(n) {
  const code = Number(n) || 0;
  const name = TIPOCOMP_LABELS[code];
  const codeTxt = String(Math.trunc(code)).padStart(2, "0");
  if (name) {
    return "TIPOCOMP " + codeTxt + " — " + name;
  }
  return "TIPOCOMP " + codeTxt;
}

const sumIvaExpr = {
  $sum: {
    $add: [{ $ifNull: ["$F_IVA1", 0] }, { $ifNull: ["$F_IVA2", 0] }],
  },
};

const sumNetoGravadoExpr = {
  $sum: {
    $add: [
      { $ifNull: ["$F_SUB1", 0] },
      { $ifNull: ["$F_SUB2", 0] },
      { $ifNull: ["$F_SUB3", 0] },
    ],
  },
};

/**
 * Planilla de ventas FACTURAS:
 * - Detalle TIPOCOMP > 0 (neto, IVA, total) + subtotal
 * - Detalle TIPOCOMP = 0 (solo total; sin neto ni IVA) + subtotal
 * - TOTAL GENERAL de ventas e impuestos
 * - Formas de pago
 */
async function buildVentasResumen(database, desde, hasta) {
  const rows = await database
    .collection("sync_facturas")
    .aggregate([
      { $match: { F_FEC: { $gte: desde, $lte: hasta } } },
      { $addFields: { _tipocompNum: tipocompNumExpr } },
      {
        $facet: {
          porTipo: [
            {
              $group: {
                _id: "$_tipocompNum",
                tipocompRaw: { $first: "$TIPOCOMP" },
                totalVentas: { $sum: { $ifNull: ["$F_NET", 0] } },
                totalIva: sumIvaExpr,
                totalNetoGravado: sumNetoGravadoExpr,
                comprobantes: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          formasPago: [
            {
              $group: {
                _id: null,
                efectivo: { $sum: { $ifNull: ["$EFECTIVO", 0] } },
                tarjetac: { $sum: { $ifNull: ["$TARJETAC", 0] } },
                tarjetad: { $sum: { $ifNull: ["$TARJETAD", 0] } },
                transfere: { $sum: { $ifNull: ["$TRANSFERE", 0] } },
                codigoqr: { $sum: { $ifNull: ["$CODIGOQR", 0] } },
                ctacte: { $sum: { $ifNull: ["$CTACTE", 0] } },
              },
            },
          ],
        },
      },
    ])
    .toArray();

  const f = rows[0] || {};
  const porTipo = f.porTipo || [];

  const mapDetalle = (row, ocultarNetoIva) => {
    const tipocomp = Number(row._id) || 0;
    return {
      tipocomp,
      tipocompRaw: row.tipocompRaw != null ? String(row.tipocompRaw) : "",
      concepto: tipocompLabel(tipocomp),
      totalVentas: round2(row.totalVentas),
      totalNetoGravado: ocultarNetoIva ? null : round2(row.totalNetoGravado),
      totalIva: ocultarNetoIva ? null : round2(row.totalIva),
      comprobantes: row.comprobantes || 0,
      ocultarNetoIva: !!ocultarNetoIva,
      esDetalle: true,
      esSubtotal: false,
      esTotal: false,
      grupo: tipocomp > 0 ? "tipocomp_gt0" : "tipocomp_eq0",
    };
  };

  const sumKey = (list, key) =>
    round2(list.reduce((s, r) => s + (Number(r[key]) || 0), 0));
  const countRows = (list) =>
    list.reduce((s, r) => s + (r.comprobantes || 0), 0);

  const filasGt0 = porTipo
    .filter((r) => Number(r._id) > 0)
    .map((r) => mapDetalle(r, false));
  const filasEq0 = porTipo
    .filter((r) => Number(r._id) <= 0)
    .map((r) => mapDetalle(r, true));

  const subtotalGt0 = {
    tipocomp: null,
    tipocompRaw: "",
    concepto: "SUBTOTAL TIPOCOMP > 0",
    totalVentas: sumKey(filasGt0, "totalVentas"),
    totalNetoGravado: sumKey(filasGt0, "totalNetoGravado"),
    totalIva: sumKey(filasGt0, "totalIva"),
    comprobantes: countRows(filasGt0),
    ocultarNetoIva: false,
    esDetalle: false,
    esSubtotal: true,
    esTotal: false,
    grupo: "tipocomp_gt0",
  };

  const subtotalEq0 = {
    tipocomp: null,
    tipocompRaw: "",
    concepto: "SUBTOTAL TIPOCOMP = 0",
    totalVentas: sumKey(filasEq0, "totalVentas"),
    totalNetoGravado: null,
    totalIva: null,
    comprobantes: countRows(filasEq0),
    ocultarNetoIva: true,
    esDetalle: false,
    esSubtotal: true,
    esTotal: false,
    grupo: "tipocomp_eq0",
  };

  // Total general: ventas de ambos grupos + impuestos (neto/IVA solo de TIPOCOMP > 0)
  const totalVentasGeneral = round2(
    subtotalGt0.totalVentas + subtotalEq0.totalVentas
  );
  const totalNetoGeneral = subtotalGt0.totalNetoGravado;
  const totalIvaGeneral = subtotalGt0.totalIva;
  const totalCompGeneral = subtotalGt0.comprobantes + subtotalEq0.comprobantes;

  const filaTotalGeneral = {
    tipocomp: null,
    tipocompRaw: "",
    concepto: "TOTAL GENERAL DE VENTAS E IMPUESTOS",
    totalVentas: totalVentasGeneral,
    totalNetoGravado: totalNetoGeneral,
    totalIva: totalIvaGeneral,
    comprobantes: totalCompGeneral,
    ocultarNetoIva: false,
    esDetalle: false,
    esSubtotal: false,
    esTotal: true,
    grupo: "total",
  };

  const planillaVentas = []
    .concat(filasGt0)
    .concat([subtotalGt0])
    .concat(filasEq0)
    .concat([subtotalEq0])
    .concat([filaTotalGeneral]);

  const pago = (f.formasPago || [])[0] || {};
  const planillaPagos = [
    { campo: "EFECTIVO", concepto: "Efectivo", importe: round2(pago.efectivo) },
    {
      campo: "TARJETAD",
      concepto: "Tarjeta débito",
      importe: round2(pago.tarjetad),
    },
    {
      campo: "TARJETAC",
      concepto: "Tarjeta crédito",
      importe: round2(pago.tarjetac),
    },
    {
      campo: "TRANSFERE",
      concepto: "Transferencia",
      importe: round2(pago.transfere),
    },
    {
      campo: "CODIGOQR",
      concepto: "Código QR",
      importe: round2(pago.codigoqr),
    },
    {
      campo: "CTACTE",
      concepto: "Cuenta corriente",
      importe: round2(pago.ctacte),
    },
  ];
  const totalPagos = round2(
    planillaPagos.reduce((s, row) => s + (row.importe || 0), 0)
  );

  return {
    planillaVentas,
    planillaPagos,
    totalPagos,
    subtotalTipocompGt0: {
      totalVentas: subtotalGt0.totalVentas,
      totalNetoGravado: subtotalGt0.totalNetoGravado,
      totalIva: subtotalGt0.totalIva,
      comprobantes: subtotalGt0.comprobantes,
    },
    subtotalTipocompEq0: {
      totalVentas: subtotalEq0.totalVentas,
      totalNetoGravado: null,
      totalIva: null,
      comprobantes: subtotalEq0.comprobantes,
    },
    totalesGenerales: {
      totalVentas: filaTotalGeneral.totalVentas,
      totalNetoGravado: filaTotalGeneral.totalNetoGravado,
      totalIva: filaTotalGeneral.totalIva,
      comprobantes: filaTotalGeneral.comprobantes,
    },
    // Compatibilidad con consumidores previos
    arca: {
      totalPesos: subtotalGt0.totalVentas,
      totalIva: subtotalGt0.totalIva,
      totalNetoGravado: subtotalGt0.totalNetoGravado,
      comprobantes: subtotalGt0.comprobantes,
    },
    noArca: {
      totalPesos: subtotalEq0.totalVentas,
      totalIva: null,
      totalNetoGravado: null,
      comprobantes: subtotalEq0.comprobantes,
    },
    totalPesos: filaTotalGeneral.totalVentas,
    totalIva: filaTotalGeneral.totalIva,
    totalNetoGravado: filaTotalGeneral.totalNetoGravado,
    comprobantes: filaTotalGeneral.comprobantes,
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

/** Primera y última fecha de FACTURAS (para el almanaque / validación de rango) */
app.get("/api/reports/rango-fechas", auth, async (_req, res) => {
  try {
    const database = await ensureDb();
    const bounds = await getFacturasFechaBounds(database);
    if (!bounds) {
      return res.json({
        ok: true,
        origen: "mongodb",
        database: MONGODB_DB,
        tabla: "FACTURAS",
        primera: null,
        ultima: null,
        comprobantes: 0,
      });
    }
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      tabla: "FACTURAS",
      primera: bounds.primera,
      ultima: bounds.ultima,
      primeraTxt: toBritishDate(bounds.primera),
      ultimaTxt: toBritishDate(bounds.ultima),
      comprobantes: bounds.comprobantes,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// Totales de ventas por rango (FACTURAS)
app.get("/api/reports/ventas", auth, async (req, res) => {
  try {
    const database = await ensureDb();
    const range = await parseDateRangeAgainstFacturas(database, req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const resumen = await buildVentasResumen(database, desde, hasta);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      primera: range.primera,
      ultima: range.ultima,
      resumen,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// Cantidades/kilos por código de rubro (ANAVENTA.RUBRO)
app.get("/api/reports/articulos-rubros", auth, async (req, res) => {
  try {
    const database = await ensureDb();
    const range = await parseDateRangeAgainstFacturas(database, req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const data = await buildCantidadesPorRubro(database, desde, hasta);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      primera: range.primera,
      ultima: range.ultima,
      ...data,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

// Alias: cantidades/kilos por rubro desde ANAVENTA
app.get("/api/reports/cantidades", auth, async (req, res) => {
  try {
    const database = await ensureDb();
    const range = await parseDateRangeAgainstFacturas(database, req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
    const data = await buildCantidadesPorRubro(database, desde, hasta);
    res.json({
      ok: true,
      origen: "mongodb",
      database: MONGODB_DB,
      desde,
      hasta,
      primera: range.primera,
      ultima: range.ultima,
      ...data,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

/** Período: ventas + cantidades por rubro */
app.get("/api/reports/periodo", auth, async (req, res) => {
  try {
    const database = await ensureDb();
    const range = await parseDateRangeAgainstFacturas(database, req.query);
    if (range.error) {
      return res.status(400).json({ ok: false, mensaje: range.error });
    }
    const { desde, hasta } = range;
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
      primera: range.primera,
      ultima: range.ultima,
      ventas: { resumen: ventasResumen },
      cantidades,
      kilosRubros: cantidades,
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

/** Tablas con campo fecha usable para borrado por rango */
const DATE_TABLES = [
  { id: "sync_facturas", label: "FACTURAS", dbf: "FACTURAS.DBF", dateField: "F_FEC" },
  { id: "sync_anaventa", label: "ANAVENTA", dbf: "ANAVENTA.DBF", dateField: "FECHA" },
  { id: "sync_ctactecc", label: "CTACTECC", dbf: "CTACTECC.DBF", dateField: "FECHA" },
];

function resolvePathDbf() {
  const fromEnv = String(
    process.env.PATHDBF || process.env.JULIOABE_PATH || ""
  ).trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "win32" && fs.existsSync("C:\\JULIOABE")) {
    return "C:\\JULIOABE";
  }
  return path.join(__dirname, "..", "..");
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
  if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(2) + " MB";
  return (v / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function getDiskFree(dirPath) {
  try {
    if (typeof fs.statfsSync === "function") {
      const st = fs.statfsSync(dirPath);
      const bsize = Number(st.bsize || st.frsize || 0);
      const bavail = Number(st.bavail != null ? st.bavail : st.bfree || 0);
      const blocks = Number(st.blocks || 0);
      if (bsize > 0 && blocks > 0) {
        return {
          freeBytes: bsize * bavail,
          totalBytes: bsize * blocks,
        };
      }
    }
  } catch (_) {}
  // Fallback Windows: wmic / PowerShell
  if (process.platform === "win32") {
    try {
      const { execSync } = require("child_process");
      const drive = String(dirPath).slice(0, 2).toUpperCase(); // C:
      const ps =
        "$d=Get-PSDrive -Name '" +
        drive.replace(":", "") +
        "'; [pscustomobject]@{Free=$d.Free;Used=$d.Used}";
      const out = execSync(
        'powershell -NoProfile -Command "' + ps + ' | ConvertTo-Json"',
        { encoding: "utf8", timeout: 8000, windowsHide: true }
      );
      const j = JSON.parse(out);
      const free = Number(j.Free || 0);
      const used = Number(j.Used || 0);
      if (free > 0 || used > 0) {
        return { freeBytes: free, totalBytes: free + used };
      }
    } catch (_) {}
  }
  return null;
}

function dateRangeMongoFilter(field, desde, hasta) {
  const desdeDt = new Date(desde + "T00:00:00.000Z");
  const hastaDt = new Date(hasta + "T23:59:59.999Z");
  return {
    $or: [
      { [field]: { $gte: desde, $lte: hasta } },
      { [field]: { $gte: desdeDt, $lte: hastaDt } },
    ],
  };
}

/** Espacio DBF locales + tamaño de colecciones MongoDB */
app.get("/api/storage/espacio", auth, async (_req, res) => {
  try {
    const database = await ensureDb();
    const pathDbf = resolvePathDbf();
    const pathExists = fs.existsSync(pathDbf);
    const disk = pathExists ? getDiskFree(pathDbf) : null;

    const dbfTables = [];
    let dbfTotalBytes = 0;
    for (const t of TABLES) {
      if (!t.dbf) continue;
      const full = path.join(pathDbf, t.dbf);
      let sizeBytes = 0;
      let exists = false;
      if (pathExists && fs.existsSync(full)) {
        exists = true;
        sizeBytes = fs.statSync(full).size;
        dbfTotalBytes += sizeBytes;
      }
      dbfTables.push({
        id: t.id,
        label: t.label,
        dbf: t.dbf,
        path: full,
        exists,
        sizeBytes,
        sizeHuman: formatBytes(sizeBytes),
      });
    }

    const mongoTables = [];
    let mongoTotalBytes = 0;
    let mongoTotalDocs = 0;
    let mongoDataBytes = 0;
    let mongoIndexBytes = 0;
    for (const t of TABLES) {
      let count = 0;
      let storageSize = 0;
      let size = 0;
      let exists = false;
      try {
        const cols = await database.listCollections({ name: t.id }).toArray();
        exists = cols.length > 0;
        if (exists) {
          const st = await database.command({ collStats: t.id });
          count = Number(st.count || 0);
          storageSize = Number(st.storageSize || 0);
          size = Number(st.size || 0);
          mongoTotalBytes += storageSize;
          mongoDataBytes += size;
          mongoIndexBytes += Number(st.totalIndexSize || st.indexSize || 0);
          mongoTotalDocs += count;
        }
      } catch (_) {
        exists = false;
      }
      mongoTables.push({
        id: t.id,
        label: t.label,
        exists,
        count,
        storageBytes: storageSize,
        dataBytes: size,
        storageHuman: formatBytes(storageSize),
        dataHuman: formatBytes(size),
      });
    }

    // Espacio disponible MongoDB: dbStats (fs*) o cupo configurado (Atlas)
    let mongoQuotaBytes = 0;
    let mongoUsedBytes = mongoTotalBytes;
    let mongoFreeSource = "colecciones";
    try {
      const dbSt = await database.command({ dbStats: 1, scale: 1 });
      const fsUsed = Number(dbSt.fsUsedSize || 0);
      const fsTotal = Number(dbSt.fsTotalSize || 0);
      const storageSize = Number(dbSt.storageSize || 0);
      const indexSize = Number(dbSt.indexSize || 0);
      const dataSize = Number(dbSt.dataSize || 0);
      if (fsUsed > 0) {
        mongoUsedBytes = fsUsed;
        mongoFreeSource = "dbStats.fsUsedSize";
      } else if (storageSize + indexSize > 0) {
        mongoUsedBytes = storageSize + indexSize;
        mongoFreeSource = "dbStats.storage+index";
      } else if (dataSize > 0) {
        mongoUsedBytes = dataSize;
        mongoFreeSource = "dbStats.dataSize";
      }
      if (fsTotal > 0) {
        mongoQuotaBytes = fsTotal;
        mongoFreeSource += "+fsTotalSize";
      }
    } catch (_) {}

    const limitMb = Number(
      process.env.MONGODB_STORAGE_LIMIT_MB || process.env.ATLAS_STORAGE_LIMIT_MB || 0
    );
    if (!mongoQuotaBytes && limitMb > 0) {
      mongoQuotaBytes = Math.round(limitMb * 1024 * 1024);
      mongoFreeSource += (mongoFreeSource ? "+" : "") + "MONGODB_STORAGE_LIMIT_MB";
    }
    // Atlas M0 por defecto si no hay otra fuente de cupo
    if (!mongoQuotaBytes) {
      mongoQuotaBytes = 512 * 1024 * 1024;
      mongoFreeSource += (mongoFreeSource ? "+" : "") + "default_Atlas_M0_512MB";
    }

    const mongoFreeBytes = Math.max(0, mongoQuotaBytes - mongoUsedBytes);
    const mongoUsedPct =
      mongoQuotaBytes > 0
        ? Math.round((mongoUsedBytes / mongoQuotaBytes) * 1000) / 10
        : null;

    res.json({
      ok: true,
      pathDbf,
      pathExists,
      disk: disk
        ? {
            freeBytes: disk.freeBytes,
            totalBytes: disk.totalBytes,
            freeHuman: formatBytes(disk.freeBytes),
            totalHuman: formatBytes(disk.totalBytes),
            usedPct:
              disk.totalBytes > 0
                ? Math.round(
                    ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 1000
                  ) / 10
                : null,
          }
        : null,
      dbf: {
        tables: dbfTables,
        totalBytes: dbfTotalBytes,
        totalHuman: formatBytes(dbfTotalBytes),
        disponibleHuman: disk ? formatBytes(disk.freeBytes) : null,
        nota: pathExists
          ? "Tamanos de archivos DBF en disco local"
          : "Esta instancia no tiene acceso a C:\\JULIOABE (p.ej. Render). Solo se muestra MongoDB.",
      },
      mongodb: {
        database: MONGODB_DB,
        tables: mongoTables,
        totalDocs: mongoTotalDocs,
        totalStorageBytes: mongoTotalBytes,
        totalStorageHuman: formatBytes(mongoTotalBytes),
        usedBytes: mongoUsedBytes,
        usedHuman: formatBytes(mongoUsedBytes),
        quotaBytes: mongoQuotaBytes,
        quotaHuman: formatBytes(mongoQuotaBytes),
        freeBytes: mongoFreeBytes,
        freeHuman: formatBytes(mongoFreeBytes),
        usedPct: mongoUsedPct,
        source: mongoFreeSource,
      },
      borrables: DATE_TABLES.map((t) => ({
        id: t.id,
        label: t.label,
        dateField: t.dateField,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

async function countDeleteByRange(database, desde, hasta, tableIds) {
  const wanted = new Set(
    (tableIds && tableIds.length ? tableIds : DATE_TABLES.map((t) => t.id)).map(
      String
    )
  );
  const detalle = [];
  let total = 0;
  for (const t of DATE_TABLES) {
    if (!wanted.has(t.id)) continue;
    const filter = dateRangeMongoFilter(t.dateField, desde, hasta);
    let count = 0;
    try {
      count = await database.collection(t.id).countDocuments(filter);
    } catch (_) {
      count = 0;
    }
    total += count;
    detalle.push({
      id: t.id,
      label: t.label,
      dateField: t.dateField,
      count,
      filterCampos: t.dateField,
    });
  }
  return { total, detalle, desde, hasta };
}

/** Vista previa: cuantos registros se borrarian */
app.post("/api/admin/preview-borrar", auth, async (req, res) => {
  try {
    const database = await ensureDb();
    const desde = toIsoDate(req.body && req.body.desde);
    const hasta = toIsoDate(req.body && req.body.hasta);
    if (!desde || !hasta) {
      return res.status(400).json({
        ok: false,
        mensaje: "Indique fechas Desde y Hasta (DD/MM/AAAA)",
      });
    }
    if (desde > hasta) {
      return res.status(400).json({
        ok: false,
        mensaje: "La fecha Desde no puede ser mayor que Hasta",
      });
    }
    const tables = Array.isArray(req.body && req.body.tables)
      ? req.body.tables
      : null;
    const data = await countDeleteByRange(database, desde, hasta, tables);
    res.json({
      ok: true,
      ...data,
      desdeBritish: toBritishDate(desde),
      hastaBritish: toBritishDate(hasta),
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: String(err.message || err) });
  }
});

/**
 * Borra registros de MongoDB en un rango de fechas.
 * Requiere confirmar con la misma clave de acceso (password).
 */
app.post("/api/admin/borrar-rango", auth, async (req, res) => {
  try {
    const pass = String((req.body && req.body.password) || "").trim();
    if (!pass || pass.toLowerCase() !== APP_PASSWORD.toLowerCase()) {
      return res.status(401).json({
        ok: false,
        mensaje: "Clave incorrecta. No se borro nada.",
      });
    }
    const confirm = String((req.body && req.body.confirm) || "")
      .trim()
      .toUpperCase();
    if (confirm !== "BORRAR") {
      return res.status(400).json({
        ok: false,
        mensaje: 'Para confirmar escriba BORRAR en el campo de confirmacion.',
      });
    }

    const database = await ensureDb();
    const desde = toIsoDate(req.body && req.body.desde);
    const hasta = toIsoDate(req.body && req.body.hasta);
    if (!desde || !hasta) {
      return res.status(400).json({
        ok: false,
        mensaje: "Indique fechas Desde y Hasta (DD/MM/AAAA)",
      });
    }
    if (desde > hasta) {
      return res.status(400).json({
        ok: false,
        mensaje: "La fecha Desde no puede ser mayor que Hasta",
      });
    }

    const tables = Array.isArray(req.body && req.body.tables)
      ? req.body.tables
      : null;
    const wanted = new Set(
      (tables && tables.length ? tables : DATE_TABLES.map((t) => t.id)).map(
        String
      )
    );

    const detalle = [];
    let total = 0;
    for (const t of DATE_TABLES) {
      if (!wanted.has(t.id)) continue;
      const filter = dateRangeMongoFilter(t.dateField, desde, hasta);
      const result = await database.collection(t.id).deleteMany(filter);
      const deleted = Number(result.deletedCount || 0);
      total += deleted;
      detalle.push({
        id: t.id,
        label: t.label,
        dateField: t.dateField,
        deleted,
      });
    }

    console.log(
      `[admin] borrar-rango ${desde}..${hasta} total=${total}`,
      detalle
    );

    res.json({
      ok: true,
      mensaje:
        total > 0
          ? "Se eliminaron " + total + " registros de MongoDB."
          : "No habia registros en ese rango.",
      total,
      detalle,
      desde,
      hasta,
      desdeBritish: toBritishDate(desde),
      hastaBritish: toBritishDate(hasta),
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
