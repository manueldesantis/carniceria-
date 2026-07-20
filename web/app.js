(() => {
  const state = {
    token: localStorage.getItem("clientebd_token") || "",
    table: null,
    page: 1,
    pages: 1,
    limit: 25,
    q: "",
    columns: [],
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
      if (!primera || !ultima) {
        if (hint) {
          hint.textContent = "No hay facturas sincronizadas para limitar el almanaque.";
        }
        defaultDates(null, null);
        return;
      }
      desdeEl.min = primera;
      desdeEl.max = ultima;
      hastaEl.min = primera;
      hastaEl.max = ultima;
      if (hint) {
        hint.innerHTML =
          "Almanaque limitado a facturas sincronizadas: <strong>" +
          escapeHtml(toBritish(primera)) +
          "</strong> → <strong>" +
          escapeHtml(toBritish(ultima)) +
          "</strong> (" +
          (data.comprobantes || 0) +
          " comprobantes)";
      }
      defaultDates(primera, ultima);
    } catch (e) {
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
      // Últimos 30 días dentro del rango disponible
      const d = new Date(ultima + "T12:00:00");
      d.setDate(d.getDate() - 30);
      desdeIso = d.toISOString().slice(0, 10);
      if (primera && desdeIso < primera) desdeIso = primera;
    }

    if (!desdeEl.value) desdeEl.value = clampIso(desdeIso, primera, ultima);
    if (!hastaEl.value) hastaEl.value = clampIso(hastaIso, primera, ultima);

    // Si ya había valores fuera de rango, corregirlos
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
    if (!desde || !hasta) {
      throw new Error("Seleccione fechas Desde y Hasta en el almanaque");
    }
    if (desde > hasta) {
      throw new Error("La fecha Desde no puede ser mayor que Hasta");
    }
    if (desdeEl.min && desde < desdeEl.min) {
      throw new Error("La fecha Desde es anterior a la primera factura sincronizada");
    }
    if (hastaEl.max && hasta > hastaEl.max) {
      throw new Error("La fecha Hasta es posterior a la última factura sincronizada");
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
  }

  async function loadVentas() {
    const err = $("reportes-error");
    err.classList.add("hidden");
    try {
      const { qs } = getReporteRange();
      const data = await api("/api/reports/ventas?" + qs);
      setPeriodoHint(data);
      showReportPanel("ventas");
      const rv = data.resumen || {};
      const el = $("ventas-resumen");
      if (!el) throw new Error("No se encontró el panel de totales");
      renderKpis(el, [
        { label: "Total en Pesos", value: "$ " + money(rv.totalPesos) },
        { label: "Total en IVA ventas", value: "$ " + money(rv.totalIva) },
        { label: "Total neto gravado", value: "$ " + money(rv.totalNetoGravado) },
      ]);
    } catch (e) {
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
              row.rubro +
              "</td><td>" +
              escapeHtml(row.nombre) +
              "</td><td>" +
              kilos(row.kgs) +
              "</td><td>$ " +
              money(row.importe) +
              "</td></tr>"
          )
          .join("") || '<tr><td colspan="4">Sin datos en el rango</td></tr>';
    } catch (e) {
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
