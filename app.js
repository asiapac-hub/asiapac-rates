// app.js (FULL) — Autocomplete + Excel parsing + Currency handling + Local + Remarks
// -----------------------------------------------------------------------------------

const EXCEL_PATH = "data/tarifas.xlsx";
const SHEET_RATES = "RATES";
const SHEET_LOCAL = "GASTOS_LOCALES";
const SHEET_REMARKS = "REMARKS";

// UI
const elPOL = document.getElementById("polInput");
const elPOD = document.getElementById("podInput");
const elPOLMenu = document.getElementById("polMenu");
const elPODMenu = document.getElementById("podMenu");
const elBtn = document.getElementById("searchBtn");
const elResults = document.getElementById("results");
const elLocal = document.getElementById("localCharges");
const elRemarks = document.getElementById("remarksSection");
const elStatus = document.getElementById("status");

let rates = [];
let localCharges = [];
let remarks = [];

let polOptions = [];
let podOptions = [];

// -------------------- Helpers --------------------

function norm(v) {
  return (v ?? "").toString().trim();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setStatus(msg) {
  elStatus.textContent = msg || "";
}

// -------------------- Currency Handling --------------------

function normalizeCurrencyDisplay(value) {
  const v = norm(value);
  if (!v) return v;

  // Already formatted like "USD 3,420"
  if (/^(USD|EUR)\s+/i.test(v)) return v.toUpperCase();

  // Symbol cases
  if (v.includes("€")) return "EUR " + v.replace("€", "").trim();
  if (v.includes("$")) return "USD " + v.replace("$", "").trim();

  // If ends with USD/EUR
  const m = v.match(/\b(USD|EUR)\b/i);
  if (m) {
    const cur = m[1].toUpperCase();
    const num = v.replace(/\b(USD|EUR)\b/ig, "").trim();
    return `${cur} ${num}`;
  }

  // DEFAULT → USD
  return `USD ${v}`;
}

// -------------------- Autocomplete --------------------

function setupCombo(inputEl, menuEl, getOptions) {
  const root = inputEl.closest(".combo");
  const btn = root.querySelector(".combo-btn");

  function open() { root.classList.add("open"); }
  function close() { root.classList.remove("open"); }

  function renderList(values) {
    if (!values.length) {
      menuEl.innerHTML = `<div class="combo-empty">No hay opciones</div>`;
      return;
    }
    menuEl.innerHTML = values.map(v =>
      `<div class="combo-option">${escapeHtml(v)}</div>`
    ).join("");
  }

  function showAll() {
    renderList(getOptions());
    open();
  }

  function filter() {
    const q = inputEl.value.toLowerCase();
    const filtered = getOptions().filter(x => x.toLowerCase().includes(q));
    renderList(filtered);
    open();
  }

  inputEl.addEventListener("focus", showAll);
  inputEl.addEventListener("click", showAll);
  inputEl.addEventListener("input", filter);

  btn.addEventListener("click", () => {
    if (root.classList.contains("open")) close();
    else showAll();
  });

  menuEl.addEventListener("click", e => {
    const opt = e.target.closest(".combo-option");
    if (!opt) return;
    inputEl.value = opt.textContent;
    close();
  });

  document.addEventListener("click", e => {
    if (!root.contains(e.target)) close();
  });
}

// -------------------- Results --------------------

function renderResults(rows) {
  if (!rows.length) {
    elResults.innerHTML = `<p class="status">No se encontraron tarifas.</p>`;
    return;
  }

  const headers = ["POL", "POD", "NOR", "20GP", "40HC", "Validez", "Dias libres", "Naviera", "Agente"];

  const thead = `
    <thead>
      <tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${escapeHtml(r.POL)}</td>
          <td>${escapeHtml(r.POD)}</td>
          <td>${escapeHtml(normalizeCurrencyDisplay(r.NOR))}</td>
          <td>${escapeHtml(normalizeCurrencyDisplay(r["20GP"]))}</td>
          <td>${escapeHtml(normalizeCurrencyDisplay(r["40HC"]))}</td>
          <td>${escapeHtml(r.Validez)}</td>
          <td>${escapeHtml(r["Dias libres"])}</td>
          <td>${escapeHtml(r.NAVIERA)}</td>
          <td>${escapeHtml(r.Agente)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;

  elResults.innerHTML = `<div class="table-wrap"><table class="table">${thead}${tbody}</table></div>`;
}

// -------------------- Local Charges --------------------

function renderLocalCharges() {
  if (!localCharges.length) {
    elLocal.innerHTML = `<p class="status">No hay gastos locales.</p>`;
    return;
  }

  const rows = localCharges.map(r => ({
    Concepto: norm(r.CONCEPTO || r.Concepto),
    Detalle: norm(r.DETALLE || r.Detalle),
    Calculo: norm(r["CÁLCULO"] || r.CALCULO || r.Calculo),
    IVA: norm(r.IVA)
  }));

  elLocal.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Detalle</th>
            <th>Cálculo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.Concepto)}</td>
              <td>${escapeHtml(normalizeCurrencyDisplay(r.Detalle))}</td>
              <td>${escapeHtml(r.Calculo)}</td>
              <td><span class="badge">${r.IVA || "N/A"}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// -------------------- Remarks --------------------

function renderRemarks() {
  if (!remarks.length) {
    elRemarks.innerHTML = `<p class="status">No remarks available.</p>`;
    return;
  }

  const lines = [];
  remarks.forEach(r => {
    Object.values(r).forEach(val => {
      if (norm(val)) lines.push(norm(val));
    });
  });

  elRemarks.innerHTML = `
    <ul class="remarks-list">
      ${lines.map(l => `<li>${escapeHtml(l)}</li>`).join("")}
    </ul>
  `;
}

// -------------------- Excel Loading --------------------

async function loadExcel() {
  setStatus("Cargando tarifas...");
  elBtn.disabled = true;

  const res = await fetch(EXCEL_PATH, { cache: "no-store" });
  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  // ---- RATES
  const wsRates = workbook.Sheets[SHEET_RATES];
  const rawRates = XLSX.utils.sheet_to_json(wsRates, { raw: false });

  rates = rawRates.map(r => ({
    POL: norm(r.POL),
    POD: norm(r.POD),
    NOR: norm(r.NOR),
    "20GP": norm(r["20GP"]),
    "40HC": norm(r["40HC"] || r["40HQ"]),
    Validez: norm(r.Validez),
    "Dias libres": norm(r["Dias libres"]),
    NAVIERA: norm(r.NAVIERA),
    Agente: norm(r.Agente)
  }));

  // ---- LOCAL
  const wsLocal = workbook.Sheets[SHEET_LOCAL];
  localCharges = wsLocal ? XLSX.utils.sheet_to_json(wsLocal, { raw: false }) : [];

  // ---- REMARKS
  const wsRemarks = workbook.Sheets[SHEET_REMARKS];
  remarks = wsRemarks ? XLSX.utils.sheet_to_json(wsRemarks, { raw: false }) : [];

  // Populate autocomplete options
  polOptions = uniqueSorted(rates.map(r => r.POL));
  podOptions = uniqueSorted(rates.map(r => r.POD));

  elPOL.value = "";
  elPOD.value = "";

  renderLocalCharges();
  renderRemarks();

  setStatus("Listo.");
  elBtn.disabled = false;
}

// -------------------- Search --------------------

function onSearch() {
  const pol = norm(elPOL.value);
  const pod = norm(elPOD.value);

  if (!pol || !pod) {
    setStatus("Selecciona POL y POD.");
    renderResults([]);
    return;
  }

  const matches = rates.filter(r => r.POL === pol && r.POD === pod);
  renderResults(matches);
}

// -------------------- Init --------------------

elBtn.addEventListener("click", onSearch);

setupCombo(elPOL, elPOLMenu, () => polOptions);
setupCombo(elPOD, elPODMenu, () => podOptions);

loadExcel();
