(() => {
  const state = {
    token: localStorage.getItem("clientebd_token") || "",
    table: null,
    page: 1,
    pages: 1,
    limit: 25,
    q: "",
    columns: [],
    /** Límites de FACTURAS: cualquier rango debe cumplir primera <= desde <= hasta <= ultima */
    rangoFacturas: { primera: null, ultima: null, comprobantes: 0 },
    /** Último informe mostrado (para exportar CSV) */
    ultimoInforme: null,
  };

  const $ = (id) => document.getElementById(id);

  async function api(path, opts = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );
    if (state.token) headers.Authorization = "Bearer " + state.token;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/api/login") {
      logout(false);
      throw new Error(data.mensaje || "Sesion expirada");
    }
    if (!res.ok) throw new Error(data.mensaje || "Error HTTP " + res.status);
    return data;
  }

  function showLogin() {
    $("view-login").classList.remove("hidden");
    $("view-app").classList.add("hidden");
  }

  function showApp() {
    $("view-login").classList.add("hidden");
    $("view-app").classList.remove("hidden");
  }

  function logout(callApi) {
    if (callApi && state.token) {
      api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
    }
    state.token = "";
    localStorage.removeItem("clientebd_token");
    showLogin();
  }

  async function login() {
    const err = $("login-error");
    err.classList.add("hidden");
    try {
      const password = $("password").value;
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      state.token = data.token;
      localStorage.setItem("clientebd_token", state.token);
      $("password").value = "";
      showApp();
      await boot();
    } catch (e) {
      err.textContent = e.message || "No se pudo iniciar sesion";
      err.classList.remove("hidden");
    }
  }

  async function ping() {
    try {
      const h = await fetch("/api/health").then((r) => r.json());
      const el = $("health");
      if (h.ok && h.storage === "mongodb") {
        el.innerHTML =
          '<i class="status-dot"></i>Conectado a MongoDB (' +
          escapeHtml(h.db || "syncdbf") +
          ")";
        $("db-label").textContent = "JULIOABE / MongoDB Atlas";
      } else if (h.ok) {
        el.innerHTML = '<i class="status-dot off"></i>API sin MongoDB';
      } else {
        el.innerHTML =
          '<i class="status-dot off"></i>' +
          escapeHtml(h.mensaje || "Sin conexion MongoDB");
      }
    } catch {
      $("health").innerHTML = '<i class="status-dot off"></i>API offline';
    }
  }

  async function loadTables() {
    const data = await api("/api/tables");
    const root = $("tables");
    root.innerHTML = "";
    data.tables.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "table-card" + (state.table === t.id ? " active" : "");
      btn.type = "button";
      btn.innerHTML =
        "<strong>" +
        escapeHtml(t.label) +
        "</strong><small>" +
        escapeHtml(t.id) +
        "<br/>" +
        (t.exists ? t.count + " regs" : "sin datos") +
        "</small>";
      btn.disabled = !t.exists;
      btn.onclick = () => {
        state.table = t.id;
        state.page = 1;
        state.q = "";
        $("q").value = "";
        $("current-table").textContent = t.label;
        loadTables();
        loadDocs();
      };
      root.appendChild(btn);
    });
  }

  function pickColumns(docs) {
    const preferred = [
      "F_NUM",
      "F_NOM",
      "F_FEC",
      "F_NET",
      "CLAVE",
      "C_NRO",
      "C_RSO",
      "CODART",
      "NOMBRE",
      "PRECIO",
      "CODIGO",
      "FECHA",
      "IMPORTE",
      "DETALLE",
    ];
    const keys = new Set();
    docs.forEach((d) =>
      Object.keys(d).forEach((k) => {
        if (k !== "_id" && k !== "_sync") keys.add(k);
      })
    );
    const ordered = preferred.filter((k) => keys.has(k));
    const rest = [...keys].filter((k) => !ordered.includes(k)).slice(0, 8);
    return (ordered.concat(rest)).slice(0, 8);
  }

  async function loadDocs() {
    const err = $("docs-error");
    err.classList.add("hidden");
    if (!state.table) return;
    try {
      const qs = new URLSearchParams({
        page: String(state.page),
        limit: String(state.limit),
      });
      if (state.q) qs.set("q", state.q);
      const data = await api(
        "/api/tables/" + encodeURIComponent(state.table) + "/docs?" + qs
      );
      state.pages = data.pages;
      state.columns = pickColumns(data.docs || []);
      renderTable(data.docs || []);
      $("page-info").textContent =
        "Pag. " + data.page + " / " + data.pages + " · " + data.total + " regs";
      $("btn-prev").disabled = data.page <= 1;
      $("btn-next").disabled = data.page >= data.pages;
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  function renderTable(docs) {
    const thead = $("thead");
    const tbody = $("tbody");
    thead.innerHTML =
      "<tr>" +
      state.columns.map((c) => "<th>" + escapeHtml(c) + "</th>").join("") +
      "</tr>";
    tbody.innerHTML = "";
    if (!docs.length) {
      tbody.innerHTML =
        '<tr><td colspan="' +
        Math.max(1, state.columns.length) +
        '">Sin registros</td></tr>';
      return;
    }
    docs.forEach((doc) => {
      const tr = document.createElement("tr");
      tr.innerHTML = state.columns
        .map((c) => "<td>" + escapeHtml(fmt(doc[c])) + "</td>")
        .join("");
      tr.onclick = () => openDoc(doc);
      tbody.appendChild(tr);
    });
  }

  function openDoc(doc) {
    $("doc-json").textContent = JSON.stringify(doc, null, 2);
    $("drawer").classList.add("open");
    $("backdrop").classList.add("open");
  }

  function closeDrawer() {
    $("drawer").classList.remove("open");
    $("backdrop").classList.remove("open");
  }

  function fmt(v) {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return toBritish(s.slice(0, 10));
    return s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return Number(n || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function kilos(n) {
    return Number(n || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  }

  /** ISO YYYY-MM-DD → británico DD/MM/YYYY */
  function toBritish(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
    if (!m) return String(iso || "");
    return m[3] + "/" + m[2] + "/" + m[1];
  }

  /** Británico DD/MM/YYYY → ISO (también acepta ISO) */
  function toIso(value) {
    const s = String(value || "").trim();
    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return m[3] + "-" + m[2] + "-" + m[1];
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return s;
    return "";
  }

  function clampIso(iso, minIso, maxIso) {
    if (!iso) return iso;
    if (minIso && iso < minIso) return minIso;
    if (maxIso && iso > maxIso) return maxIso;
    return iso;
  }

  async function loadRangoFacturas() {
    const hint = $("reportes-rango");
    const desdeEl = $("rep-desde");
    const hastaEl = $("rep-hasta");
    if (!desdeEl || !hastaEl) return;
    try {
      const data = await api("/api/reports/rango-fechas");
      const primera = data.primera;
      const ultima = data.ultima;
      state.rangoFacturas = {
        primera: primera || null,
        ultima: ultima || null,
        comprobantes: data.comprobantes || 0,
      };
      if (!primera || !ultima) {
        desdeEl.removeAttribute("min");
        desdeEl.removeAttribute("max");
        hastaEl.removeAttribute("min");
        hastaEl.removeAttribute("max");
        if (hint) {
          hint.textContent =
            "No hay comprobantes en FACTURAS. Sincronice FACTURAS.DBF para poder consultar por fechas.";
        }
        defaultDates(null, null);
        return;
      }
      // Almanaque: permite cualquier día entre el primer y el último comprobante
      desdeEl.min = primera;
      desdeEl.max = ultima;
      hastaEl.min = primera;
      hastaEl.max = ultima;
      if (hint) {
        hint.innerHTML =
          "Puede ingresar <strong>cualquier rango</strong> entre el primer y el último comprobante de <strong>FACTURAS</strong>: " +
          "<strong>" +
          escapeHtml(toBritish(primera)) +
          "</strong> → <strong>" +
          escapeHtml(toBritish(ultima)) +
          "</strong> (" +
          (data.comprobantes || 0) +
          " comprobantes). Fuera de ese intervalo no se admite.";
      }
      defaultDates(primera, ultima);
    } catch (e) {
      state.rangoFacturas = { primera: null, ultima: null, comprobantes: 0 };
      if (hint) hint.textContent = "No se pudo cargar el rango de fechas: " + e.message;
      defaultDates(null, null);
    }
  }

  function defaultDates(primera, ultima) {
    const desdeEl = $("rep-desde");
    const hastaEl = $("rep-hasta");
    if (!desdeEl || !hastaEl) return;

    const hoy = new Date().toISOString().slice(0, 10);
    let hastaIso = ultima || hoy;
    let desdeIso = primera || hoy;
    if (ultima) {
      hastaIso = ultima;
      // Por defecto: últimos 30 días dentro del rango permitido de FACTURAS
      const d = new Date(ultima + "T12:00:00");
      d.setDate(d.getDate() - 30);
      desdeIso = d.toISOString().slice(0, 10);
      if (primera && desdeIso < primera) desdeIso = primera;
    }

    if (!desdeEl.value) desdeEl.value = clampIso(desdeIso, primera, ultima);
    if (!hastaEl.value) hastaEl.value = clampIso(hastaIso, primera, ultima);

    if (primera || ultima) {
      desdeEl.value = clampIso(desdeEl.value, primera, ultima);
      hastaEl.value = clampIso(hastaEl.value, primera, ultima);
    }
  }

  function setTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    $("tab-consulta").classList.toggle("hidden", name !== "consulta");
    $("tab-reportes").classList.toggle("hidden", name !== "reportes");
  }

  function renderKpis(el, items) {
    el.innerHTML = items
      .map(
        (i) =>
          '<div class="kpi"><span>' +
          escapeHtml(i.label) +
          "</span><b>" +
          escapeHtml(i.value) +
          "</b></div>"
      )
      .join("");
  }

  function getReporteRange() {
    const desdeEl = $("rep-desde");
    const hastaEl = $("rep-hasta");
    const desde = toIso(desdeEl.value);
    const hasta = toIso(hastaEl.value);
    const primera = state.rangoFacturas.primera || desdeEl.min || "";
    const ultima = state.rangoFacturas.ultima || hastaEl.max || "";

    if (!desde || !hasta) {
      throw new Error("Seleccione fechas Desde y Hasta en el almanaque");
    }
    if (desde > hasta) {
      throw new Error("La fecha Desde no puede ser mayor que Hasta");
    }
    if (!primera || !ultima) {
      throw new Error(
        "No hay comprobantes en FACTURAS para limitar el rango. Sincronice FACTURAS.DBF."
      );
    }
    if (desde < primera) {
      throw new Error(
        "La fecha Desde debe ser mayor o igual a la del primer comprobante de FACTURAS (" +
          toBritish(primera) +
          ")"
      );
    }
    if (hasta > ultima) {
      throw new Error(
        "La fecha Hasta debe ser menor o igual a la del último comprobante de FACTURAS (" +
          toBritish(ultima) +
          ")"
      );
    }
    if (hasta < primera || desde > ultima) {
      throw new Error(
        "El rango debe estar entre " +
          toBritish(primera) +
          " y " +
          toBritish(ultima) +
          " (FACTURAS)"
      );
    }
    return {
      desde,
      hasta,
      qs: new URLSearchParams({
        desde: toBritish(desde),
        hasta: toBritish(hasta),
      }),
    };
  }

  function setPeriodoHint(data) {
    $("reportes-periodo").innerHTML =
      "Período <strong>" +
      escapeHtml(toBritish(data.desde)) +
      "</strong> a <strong>" +
      escapeHtml(toBritish(data.hasta)) +
      "</strong> · Origen: <strong>MongoDB (" +
      escapeHtml(data.database || "syncdbf") +
      ")</strong>";
  }

  function showReportPanel(name) {
    $("panel-ventas").classList.toggle("hidden", name !== "ventas");
    $("panel-cantidades").classList.toggle("hidden", name !== "cantidades");
    const btnCsv = $("btn-export-csv");
    if (btnCsv) {
      btnCsv.disabled = !state.ultimoInforme || state.ultimoInforme.tipo !== name;
    }
  }

  function csvEscape(value) {
    const s = value == null ? "" : String(value);
    // Comillas si hay separador, saltos o espacios (para conservar justificación a la derecha)
    if (/[;"\r\n]/.test(s) || /^\s|\s$/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function csvLine(cols) {
    return cols.map(csvEscape).join(";");
  }

  /**
   * Formato argentino: miles con punto, centavos con coma.
   * Ej: 1234567.8 → "1.234.567,80"
   */
  function formatNumeroAr(value, decimales, blank) {
    const decW = Math.max(0, Number(decimales) || 0);
    if (blank) return "";
    if (value == null || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const neg = n < 0;
    const abs = Math.abs(n);
    const fixed = abs.toFixed(decW);
    let ent;
    let dec = "";
    if (decW > 0) {
      const parts = fixed.split(".");
      ent = parts[0];
      dec = parts[1] || "".padEnd(decW, "0");
    } else {
      ent = String(Math.round(abs));
    }
    const conMiles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const body = decW > 0 ? conMiles + "," + dec : conMiles;
    return (neg ? "-" : "") + body;
  }

  /**
   * Importe CSV: 15 enteros + 2 decimales (formato AR), justificado a la derecha.
   * Ancho fijo ~22 (15 dígitos + separadores de miles + coma + 2 decimales).
   */
  function formatImporteCsv(value, blank) {
    const width = 22;
    if (blank) return "".padStart(width, " ");
    const s = formatNumeroAr(value, 2, false);
    if (!s) return "".padStart(width, " ");
    return s.padStart(width, " ");
  }

  function formatKilosCsv(value, blank) {
    const width = 23;
    if (blank) return "".padStart(width, " ");
    const s = formatNumeroAr(value, 3, false);
    if (!s) return "".padStart(width, " ");
    return s.padStart(width, " ");
  }

  function downloadCsv(filename, lines) {
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\r\n") + "\r\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function fileStamp(desde, hasta) {
    const d = String(desde || "").replace(/-/g, "");
    const h = String(hasta || "").replace(/-/g, "");
    return d + "_" + h;
  }

  function buildCsvVentas(informe) {
    const data = informe.data || {};
    const rv = data.resumen || {};
    const lines = [];
    lines.push(csvLine(["ClienteBD JULIOABE - Planilla de ventas"]));
    lines.push(
      csvLine([
        "Periodo",
        toBritish(data.desde) + " a " + toBritish(data.hasta),
      ])
    );
    lines.push(csvLine(["Origen", "MongoDB / FACTURAS"]));
    lines.push(
      csvLine([
        "Formato importes",
        "15 enteros + 2 decimales; miles con punto; centavos con coma; derecha",
      ])
    );
    lines.push("");
    lines.push(
      csvLine([
        "TIPOCOMP",
        "Tipo de comprobante",
        "Comprobantes",
        "Neto gravado",
        "IVA",
        "Total",
      ])
    );
    (rv.planillaVentas || []).forEach((row) => {
      const tipocompTxt =
        row.esTotal || row.esSubtotal || row.tipocomp == null
          ? ""
          : String(Math.trunc(Number(row.tipocomp) || 0)).padStart(2, "0");
      const ocultar = !!row.ocultarNetoIva;
      const marca =
        row.esTotal || row.esSubtotal ? "** " + (row.concepto || "") : row.concepto || "";
      lines.push(
        csvLine([
          tipocompTxt,
          marca,
          row.comprobantes || 0,
          formatImporteCsv(row.totalNetoGravado, ocultar),
          formatImporteCsv(row.totalIva, ocultar),
          formatImporteCsv(row.totalVentas, false),
        ])
      );
    });
    lines.push("");
    lines.push(csvLine(["Forma de pago", "Importe"]));
    (rv.planillaPagos || []).forEach((row) => {
      lines.push(
        csvLine([row.concepto || "", formatImporteCsv(row.importe, false)])
      );
    });
    lines.push(
      csvLine([
        "** Total formas de pago",
        formatImporteCsv(rv.totalPagos, false),
      ])
    );
    return lines;
  }

  function buildCsvCantidades(informe) {
    const data = informe.data || {};
    const rk = data.resumen || {};
    const lines = [];
    lines.push(csvLine(["ClienteBD JULIOABE - Cantidades / kilos por rubro"]));
    lines.push(
      csvLine([
        "Periodo",
        toBritish(data.desde) + " a " + toBritish(data.hasta),
      ])
    );
    lines.push(csvLine(["Origen", "MongoDB / ANAVENTA"]));
    lines.push(
      csvLine([
        "Formato importes",
        "15 enteros + 2 decimales; miles con punto; centavos con coma; derecha",
      ])
    );
    lines.push(
      csvLine(["Total kilos / cantidades", formatKilosCsv(rk.kgs, false)])
    );
    lines.push(
      csvLine(["Importe total", formatImporteCsv(rk.importe, false)])
    );
    lines.push(csvLine(["Rubros con venta", Number(rk.rubros) || 0]));
    lines.push("");
    lines.push(
      csvLine(["Codigo rubro", "Nombre", "Cantidad (kilos)", "Importe"])
    );
    (data.rubros || []).forEach((row) => {
      lines.push(
        csvLine([
          row.rubro,
          row.nombre || "",
          formatKilosCsv(row.kgs, false),
          formatImporteCsv(row.importe, false),
        ])
      );
    });
    return lines;
  }

  function exportInformeCsv() {
    const err = $("reportes-error");
    err.classList.add("hidden");
    const informe = state.ultimoInforme;
    if (!informe) {
      err.textContent = "Primero genere un informe (Ventas o Cantidades).";
      err.classList.remove("hidden");
      return;
    }
    try {
      let lines;
      let filename;
      const stamp = fileStamp(informe.data.desde, informe.data.hasta);
      if (informe.tipo === "ventas") {
        lines = buildCsvVentas(informe);
        filename = "ClienteBD_Ventas_" + stamp + ".csv";
      } else if (informe.tipo === "cantidades") {
        lines = buildCsvCantidades(informe);
        filename = "ClienteBD_Cantidades_" + stamp + ".csv";
      } else {
        throw new Error("Tipo de informe desconocido");
      }
      downloadCsv(filename, lines);
    } catch (e) {
      err.textContent = e.message || String(e);
      err.classList.remove("hidden");
    }
  }

  async function loadVentas() {
    const err = $("reportes-error");
    err.classList.add("hidden");
    try {
      const { qs } = getReporteRange();
      const data = await api("/api/reports/ventas?" + qs);
      state.ultimoInforme = { tipo: "ventas", data: data };
      setPeriodoHint(data);
      showReportPanel("ventas");
      const rv = data.resumen || {};
      const bodyVentas = $("ventas-planilla-body");
      const bodyPagos = $("ventas-pagos-body");
      if (!bodyVentas || !bodyPagos) {
        throw new Error("No se encontró la planilla de ventas");
      }

      const filas = rv.planillaVentas || [];
      const fmtMoneyOrBlank = (row, value) => {
        if (row.ocultarNetoIva) return "—";
        if (value == null || value === "") return "—";
        return "$ " + money(value);
      };
      const cellTxt = (row, text) =>
        row.esTotal || row.esSubtotal
          ? "<strong>" + text + "</strong>"
          : text;
      bodyVentas.innerHTML =
        filas
          .map((row) => {
            let cls = "";
            if (row.esTotal) cls = ' class="fila-total"';
            else if (row.esSubtotal) cls = ' class="fila-subtotal"';
            const tipocompTxt =
              row.esTotal || row.esSubtotal || row.tipocomp == null
                ? "—"
                : String(Math.trunc(Number(row.tipocomp) || 0)).padStart(2, "0");
            const concepto = escapeHtml(row.concepto || "");
            const neto = escapeHtml(fmtMoneyOrBlank(row, row.totalNetoGravado));
            const iva = escapeHtml(fmtMoneyOrBlank(row, row.totalIva));
            const tot = escapeHtml("$ " + money(row.totalVentas));
            return (
              "<tr" +
              cls +
              '><td class="num">' +
              cellTxt(row, escapeHtml(tipocompTxt)) +
              "</td><td>" +
              cellTxt(row, concepto) +
              '</td><td class="num">' +
              cellTxt(row, String(row.comprobantes || 0)) +
              '</td><td class="num">' +
              cellTxt(row, neto) +
              '</td><td class="num">' +
              cellTxt(row, iva) +
              '</td><td class="num">' +
              cellTxt(row, tot) +
              "</td></tr>"
            );
          })
          .join("") ||
        '<tr><td colspan="6">Sin datos en el rango</td></tr>';

      const pagos = rv.planillaPagos || [];
      let htmlPagos = pagos
        .map(
          (row) =>
            "<tr><td>" +
            escapeHtml(row.concepto || "") +
            '</td><td class="num">$ ' +
            money(row.importe) +
            "</td></tr>"
        )
        .join("");
      htmlPagos +=
        '<tr class="fila-total"><td><strong>Total formas de pago</strong></td><td class="num"><strong>$ ' +
        money(rv.totalPagos) +
        "</strong></td></tr>";
      bodyPagos.innerHTML =
        htmlPagos || '<tr><td colspan="2">Sin datos en el rango</td></tr>';
    } catch (e) {
      state.ultimoInforme = null;
      showReportPanel("");
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function loadCantidades() {
    const err = $("reportes-error");
    err.classList.add("hidden");
    try {
      const { qs } = getReporteRange();
      const data = await api("/api/reports/cantidades?" + qs);
      state.ultimoInforme = { tipo: "cantidades", data: data };
      setPeriodoHint(data);
      showReportPanel("cantidades");
      const rk = data.resumen || {};
      renderKpis($("rubros-resumen"), [
        { label: "Total kilos / cantidades", value: kilos(rk.kgs) },
        { label: "Importe total", value: "$ " + money(rk.importe) },
        { label: "Rubros con venta", value: String(rk.rubros || 0) },
      ]);
      $("rubros-body").innerHTML =
        (data.rubros || [])
          .map(
            (row) =>
              "<tr><td>" +
              escapeHtml(String(row.rubro)) +
              "</td><td>" +
              escapeHtml(row.nombre) +
              '</td><td class="num">' +
              kilos(row.kgs) +
              '</td><td class="num">$ ' +
              money(row.importe) +
              "</td></tr>"
          )
          .join("") || '<tr><td colspan="4">Sin datos en el rango</td></tr>';
    } catch (e) {
      state.ultimoInforme = null;
      showReportPanel("");
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  }

  async function boot() {
    await ping();
    await loadTables();
    await loadRangoFacturas();
  }

  $("btn-login").onclick = login;
  $("password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("btn-logout").onclick = () => logout(true);
  $("btn-search").onclick = () => {
    state.q = $("q").value.trim();
    state.page = 1;
    loadDocs();
  };
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-search").click();
  });
  $("btn-refresh").onclick = () => {
    loadTables();
    loadDocs();
    ping();
  };
  $("btn-prev").onclick = () => {
    if (state.page > 1) {
      state.page--;
      loadDocs();
    }
  };
  $("btn-next").onclick = () => {
    if (state.page < state.pages) {
      state.page++;
      loadDocs();
    }
  };
  $("btn-close-drawer").onclick = closeDrawer;
  $("backdrop").onclick = closeDrawer;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => setTab(tab.dataset.tab);
  });
  $("btn-ventas").onclick = loadVentas;
  $("btn-cantidades").onclick = loadCantidades;
  $("btn-export-csv").onclick = exportInformeCsv;

  document.querySelectorAll(".btn-calendar").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-date-for");
      const input = id ? $(id) : null;
      if (!input) return;
      input.focus();
      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
          return;
        } catch (_) {}
      }
      input.click();
    });
  });

  // Mantener Desde/Hasta dentro de [primer comprobante, último comprobante] de FACTURAS
  ["rep-desde", "rep-hasta"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const primera = state.rangoFacturas.primera;
      const ultima = state.rangoFacturas.ultima;
      if (!primera || !ultima || !el.value) return;
      el.value = clampIso(el.value, primera, ultima);
      const desdeEl = $("rep-desde");
      const hastaEl = $("rep-hasta");
      if (desdeEl.value && hastaEl.value && desdeEl.value > hastaEl.value) {
        if (id === "rep-desde") hastaEl.value = desdeEl.value;
        else desdeEl.value = hastaEl.value;
      }
    });
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  if (state.token) {
    showApp();
    boot().catch(() => logout(false));
  } else {
    showLogin();
    ping();
  }
})();
