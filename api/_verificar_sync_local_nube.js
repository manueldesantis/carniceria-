/**
 * Compara tablas DBF locales (C:\JULIOABE) vs colecciones sync_* en MongoDB Atlas.
 */
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const { MongoClient } = require("mongodb");
const { DBFFile } = require("dbffile");

const PATH_DBF = "C:\\JULIOABE";
const DB = process.env.MONGODB_DB || "syncdbf";

const TABLES = [
  {
    dbf: "FACTURAS.DBF",
    coll: "sync_facturas",
    key: "F_NUM",
    dateField: "F_FEC",
    movement: true,
  },
  {
    dbf: "ANAVENTA.DBF",
    coll: "sync_anaventa",
    key: "F_NUM",
    dateField: "FECHA",
    movement: true,
  },
  {
    dbf: "CTACTECC.DBF",
    coll: "sync_ctactecc",
    key: "CLAVE",
    dateField: "FECHA",
    movement: true,
  },
  {
    dbf: "CLIENTES.DBF",
    coll: "sync_clientes",
    key: "C_NRO",
    dateField: null,
    movement: false,
  },
  {
    dbf: "ARTICULO.DBF",
    coll: "sync_articulo",
    key: "CODART",
    dateField: null,
    movement: false,
  },
  {
    dbf: "RUBROS.DBF",
    coll: "sync_rubros",
    key: "CODIGO",
    dateField: null,
    movement: false,
  },
];

function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function isPendingSync(val) {
  if (val === false || val === 0) return true;
  if (val === true || val === 1) return false;
  if (val == null || val === "") return true;
  const t = String(val).trim().toUpperCase();
  if (!t || ["N", "NO", "0", "F", "FALSE"].includes(t)) return true;
  if (["S", "SI", "Y", "YES", "T", "TRUE", "1"].includes(t)) return false;
  return true;
}

async function scanDbf(spec) {
  const file = path.join(PATH_DBF, spec.dbf);
  if (!fs.existsSync(file)) {
    return { ok: false, error: "DBF no encontrado: " + file };
  }
  const dbf = await DBFFile.open(file);
  let total = 0;
  let synced = 0;
  let pending = 0;
  let minDate = null;
  let maxDate = null;
  let minDateSynced = null;
  let maxDateSynced = null;
  const keysSynced = new Set();
  const keysPending = new Set();

  for await (const rec of dbf) {
    total++;
    const pend = isPendingSync(rec.SINCRONIZA);
    if (pend) {
      pending++;
      if (rec[spec.key] != null) keysPending.add(String(rec[spec.key]).trim());
    } else {
      synced++;
      if (rec[spec.key] != null) keysSynced.add(String(rec[spec.key]).trim());
    }
    if (spec.dateField) {
      const iso = toIsoDate(rec[spec.dateField]);
      if (iso) {
        if (!minDate || iso < minDate) minDate = iso;
        if (!maxDate || iso > maxDate) maxDate = iso;
        if (!pend) {
          if (!minDateSynced || iso < minDateSynced) minDateSynced = iso;
          if (!maxDateSynced || iso > maxDateSynced) maxDateSynced = iso;
        }
      }
    }
  }

  return {
    ok: true,
    file,
    recordCount: dbf.recordCount,
    total,
    synced,
    pending,
    minDate,
    maxDate,
    minDateSynced,
    maxDateSynced,
    keysSynced,
    keysPending,
  };
}

async function scanMongo(coll, spec) {
  const total = await coll.countDocuments();
  let minDate = null;
  let maxDate = null;
  if (spec.dateField) {
    const agg = await coll
      .aggregate([
        {
          $group: {
            _id: null,
            minD: { $min: "$" + spec.dateField },
            maxD: { $max: "$" + spec.dateField },
          },
        },
      ])
      .toArray();
    if (agg[0]) {
      minDate = toIsoDate(agg[0].minD);
      maxDate = toIsoDate(agg[0].maxD);
    }
  }
  // Muestra de claves en nube (hasta 5000) para cruzar
  const sample = await coll
    .find({}, { projection: { [spec.key]: 1, _id: 0 } })
    .limit(5000)
    .toArray();
  const keys = new Set(
    sample
      .map((d) => (d[spec.key] != null ? String(d[spec.key]).trim() : ""))
      .filter(Boolean)
  );
  return { total, minDate, maxDate, keysSample: keys, sampleSize: keys.size };
}

function british(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error("Falta MONGODB_URI en api/.env");
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(DB);

  console.log("============================================================");
  console.log(" Verificacion SyncDBF: LOCAL (DBF) vs NUBE (MongoDB Atlas)");
  console.log("============================================================");
  console.log(" PATHDBF : " + PATH_DBF);
  console.log(" MongoDB : " + DB);
  console.log(" Fecha   : " + new Date().toLocaleString("es-AR"));
  console.log("------------------------------------------------------------");
  console.log(
    " Nota: con FILTRARFECHA=ULTIMOMES la nube puede tener menos regs"
  );
  console.log(
    " que el DBF completo; lo importante es pendientes y rangos recientes."
  );
  console.log("============================================================\n");

  const report = [];

  for (const spec of TABLES) {
    process.stdout.write("Analizando " + spec.dbf + " ...\n");
    const local = await scanDbf(spec);
    if (!local.ok) {
      console.log("  ERROR: " + local.error);
      report.push({ tabla: spec.dbf, estado: "ERROR", detalle: local.error });
      continue;
    }
    const cloud = await scanMongo(db.collection(spec.coll), spec);

    // Cruce por muestra de claves locales marcadas SINCRONIZA=.T.
    let enNube = 0;
    let revisadas = 0;
    const sampleLocal = [...local.keysSynced].slice(0, 100);
    revisadas = sampleLocal.length;
    if (revisadas > 0) {
      const variants = [];
      for (const k of sampleLocal) {
        variants.push(k);
        if (/^\d+$/.test(k)) variants.push(Number(k));
      }
      const docs = await db
        .collection(spec.coll)
        .find({ [spec.key]: { $in: variants } }, { projection: { [spec.key]: 1 } })
        .toArray();
      const foundKeys = new Set(
        docs.map((d) => String(d[spec.key]).trim())
      );
      enNube = sampleLocal.filter((k) => foundKeys.has(k)).length;
    }

    // Para maestros, comparar conteos directos
    let estado = "OK";
    const notes = [];

    if (spec.movement) {
      if (local.pending > 0) {
        estado = "PENDIENTES";
        notes.push(local.pending + " regs locales pendientes (SINCRONIZA=.F.)");
      }
      if (cloud.total === 0 && local.synced > 0) {
        estado = "DESFASADO";
        notes.push("Hay marcados locales pero nube vacia");
      }
      if (cloud.maxDate && local.maxDate && cloud.maxDate < local.maxDate) {
        notes.push(
          "Ultima fecha nube (" +
            british(cloud.maxDate) +
            ") < local (" +
            british(local.maxDate) +
            ")"
        );
        if (estado === "OK") estado = "REVISAR";
      }
      if (revisadas > 0 && enNube < revisadas * 0.5) {
        estado = "DESFASADO";
        notes.push(
          "Solo " + enNube + "/" + revisadas + " claves sync locales halladas en nube (muestra)"
        );
      } else if (revisadas > 0) {
        notes.push(
          "Muestra claves sync: " + enNube + "/" + revisadas + " presentes en nube"
        );
      }
    } else {
      // maestros
      const diff = Math.abs(cloud.total - local.total);
      if (cloud.total === 0 && local.total > 0) {
        estado = "DESFASADO";
        notes.push("Maestro local con datos, nube vacia");
      } else if (diff > 0 && local.pending === 0 && cloud.total !== local.total) {
        // puede haber duplicados historicos en nube por re-sync
        if (cloud.total >= local.total) {
          estado = "REVISAR";
          notes.push(
            "Conteo nube (" +
              cloud.total +
              ") != local (" +
              local.total +
              ") — posibles duplicados o docs viejos en Atlas"
          );
        } else {
          estado = "DESFASADO";
          notes.push(
            "Nube (" + cloud.total + ") < local (" + local.total + ")"
          );
        }
      }
      if (local.pending > 0) {
        estado = "PENDIENTES";
        notes.push(local.pending + " pendientes de subir");
      }
      if (revisadas > 0) {
        notes.push(
          "Muestra claves sync: " + enNube + "/" + revisadas + " en nube"
        );
      }
    }

    const line = {
      tabla: spec.dbf.replace(".DBF", ""),
      coll: spec.coll,
      localTotal: local.total,
      localSynced: local.synced,
      localPending: local.pending,
      nubeTotal: cloud.total,
      localFechas: british(local.minDate) + " → " + british(local.maxDate),
      nubeFechas: british(cloud.minDate) + " → " + british(cloud.maxDate),
      estado,
      notes: notes.join("; ") || "—",
    };
    report.push(line);

    console.log("------------------------------------------------------------");
    console.log(" " + line.tabla + "  [" + line.coll + "]  → " + line.estado);
    console.log(
      "   LOCAL  total=" +
        line.localTotal +
        "  sync=.T.=" +
        line.localSynced +
        "  pend=.F.=" +
        line.localPending
    );
    console.log("   NUBE   total=" + line.nubeTotal);
    if (spec.dateField) {
      console.log("   Fechas LOCAL: " + line.localFechas);
      console.log("   Fechas NUBE : " + line.nubeFechas);
    }
    console.log("   " + line.notes);
  }

  await client.close();

  console.log("\n============================================================");
  console.log(" RESUMEN");
  console.log("============================================================");
  console.log(
    pad("TABLA", 12) +
      pad("LOCAL", 8) +
      pad("SYNC.T", 8) +
      pad("PEND", 8) +
      pad("NUBE", 8) +
      "ESTADO"
  );
  for (const r of report) {
    if (r.estado === "ERROR") {
      console.log(pad(r.tabla, 12) + r.detalle);
      continue;
    }
    console.log(
      pad(r.tabla, 12) +
        pad(String(r.localTotal), 8) +
        pad(String(r.localSynced), 8) +
        pad(String(r.localPending), 8) +
        pad(String(r.nubeTotal), 8) +
        r.estado
    );
  }
  console.log("============================================================");

  const outDir = path.join(__dirname, "..", "dist");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "VERIFICACION-SYNC-LOCAL-NUBE.txt");
  const text = report
    .map((r) =>
      r.estado === "ERROR"
        ? r.tabla + ": ERROR " + r.detalle
        : [
            r.tabla,
            "local=" + r.localTotal,
            "syncT=" + r.localSynced,
            "pend=" + r.localPending,
            "nube=" + r.nubeTotal,
            "fechasLocal=" + r.localFechas,
            "fechasNube=" + r.nubeFechas,
            r.estado,
            r.notes,
          ].join(" | ")
    )
    .join("\n");
  fs.writeFileSync(
    outFile,
    "Verificacion " +
      new Date().toLocaleString("es-AR") +
      "\n" +
      text +
      "\n",
    "utf8"
  );
  console.log("\nInforme guardado en: " + outFile);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
