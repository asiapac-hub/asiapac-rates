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

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return "";
}

// -------------------- Currency Handling --------------------

function isNA(value) {
  const v = norm(value).toUpperCase();
  return v === "N/A" || v === "NA" || v === "N.A." || v === "-";
}

function looksNumeric(value) {
  // Has at least one digit
  return /\d/.test(String(value ?? ""));
}

/**
 * Keeps Excel text like "USD 3,420" or "EUR 1,570" as-is.
 * Converts "$ 3,420" -> "USD 3,420", "€ 1,570" -> "EUR 1,570".
 * If no currency is present, defaults to "USD <value>" ONLY when it looks numeric.
 * Never prefixes currency when value is N/A.
 */
function normalizeCurrencyDisplay(value) {
  const v = norm(value);
  if (!v) return v;

  if (isNA(v)) return "N/A";

  // Already formatted like "USD 3,420" / "EUR 1,570"
  if (/^(USD|EUR)\s+/i.test(v)) {
    // Keep original spacing; normalize currency code uppercase
    return v.replace(/^(usd|eur)\b/i, (m) => m.toUpperCase());
  }

  // Symbol cases
  if (v.includes("€")) return `EUR ${v.replace("€", "").trim()}`;
  if (v.includes("$")) return `USD ${v.replace("$", "").trim()}`;

  // Contains USD/EUR somewhere else -> normalize to "USD <amount>"
  const m = v.match(/\b(USD|EUR)\b/i);
  if (m) {
    const cur = m[1].toUpperCase();
    const rest = v.replace(/\b(USD|EUR)\b/ig, "").trim();
    return `${cur} ${rest}`.trim();
  }

  // Default currency ONLY if numeric-looking
  if (looksNumeric(v)) return `USD ${v}`;

  // Non-numeric text -> leave as-is
  return v;
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

  // Requirement: click opens the menu (no need to type)
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

  const headers = ["POL", "POD", "NOR", "20GP", "40HC", "Validez", "Días libres", "Naviera", "Agente"];

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

  const rows = localCharges
    .map(r => ({
      Concepto: norm(pick(r, ["CONCEPTO", "Concepto", "concepto"])),
      Detalle:  norm(pick(r, ["DETALLE", "Detalle", "detalle"])),
      Calculo:  norm(pick(r, ["CÁLCULO", "CALCULO", "Cálculo", "Calculo", "calculo"])),
      IVA:      norm(pick(r, ["IVA", "iva", "+ IVA", "+iva", "APLICA IVA", "Aplica IVA"]))
    }))
    .filter(x => x.Concepto || x.Detalle || x.Calculo);

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
              <td><span class="badge">${escapeHtml(r.IVA || "N/A")}</span></td>
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
      const v = norm(val);
      if (v) lines.push(v);
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
  if (!res.ok) throw new Error(`No se pudo cargar el archivo: ${EXCEL_PATH}`);

  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  // ---- RATES (raw:false to preserve formatted strings like "USD 3,420")
  const wsRates = workbook.Sheets[SHEET_RATES];
  if (!wsRates) throw new Error(`No existe la hoja "${SHEET_RATES}".`);

  const rawRates = XLSX.utils.sheet_to_json(wsRates, { raw: false, defval: "" });

  rates = rawRates
    .map(r => ({
      POL: norm(pick(r, ["POL", "Pol", "PUERTO DE EMBARQUE"])),
      POD: norm(pick(r, ["POD", "Pod", "PUERTO DE DESTINO"])),
      NOR: norm(pick(r, ["NOR", "Nor"])),
      "20GP": norm(pick(r, ["20GP", "20Gp", "20 GP"])),
      // Excel might use 40HQ instead of 40HC:
      "40HC": norm(pick(r, ["40HC", "40 HQ", "40HQ", "40Hq"])),
      // IMPORTANT: headers are uppercase in your file
      Validez: norm(pick(r, ["VALIDEZ", "Validez", "validez"])),
      "Dias libres": norm(pick(r, ["DIAS LIBRES", "Dias libres", "DÍAS LIBRES", "días libres"])),
      NAVIERA: norm(pick(r, ["NAVIERA", "Naviera", "naviera"])),
      Agente: norm(pick(r, ["AGENTE", "Agente", "agente"]))
    }))
    // keep meaningful rows only
    .filter(x => x.POL || x.POD);

  // ---- LOCAL
  const wsLocal = workbook.Sheets[SHEET_LOCAL];
  localCharges = wsLocal ? XLSX.utils.sheet_to_json(wsLocal, { raw: false, defval: "" }) : [];

  // ---- REMARKS
  const wsRemarks = workbook.Sheets[SHEET_REMARKS];
  remarks = wsRemarks ? XLSX.utils.sheet_to_json(wsRemarks, { raw: false, defval: "" }) : [];

  // Populate autocomplete options
  polOptions = uniqueSorted(rates.map(r => r.POL).filter(Boolean));
  podOptions = uniqueSorted(rates.map(r => r.POD).filter(Boolean));

  elPOL.value = "";
  elPOD.value = "";

  renderLocalCharges();
  renderRemarks();

  setStatus("Listo.");
  elBtn.disabled = false;

  // Debug (optional)
  console.group("[RateFinder][DEBUG]");
  console.log("Rates loaded:", rates.length);
  console.log("Sample rate:", rates[0]);
  console.log("Local charges loaded:", localCharges.length);
  console.log("Remarks loaded:", remarks.length);
  console.groupEnd();
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

loadExcel().catch((err) => {
  console.error("[RateFinder] Error:", err);
  setStatus(`Error: ${err.message}`);
  elBtn.disabled = true;
});
