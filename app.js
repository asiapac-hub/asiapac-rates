// app.js (FULL) — No search button: auto-search on POL + POD selection
// -------------------------------------------------------------------

const EXCEL_PATH = "data/tarifas.xlsx";
const SHEET_RATES = "RATES";
const SHEET_LOCAL = "GASTOS_LOCALES";
const SHEET_REMARKS = "REMARKS";

// UI
const elPOL = document.getElementById("polInput");
const elPOD = document.getElementById("podInput");
const elPOLMenu = document.getElementById("polMenu");
const elPODMenu = document.getElementById("podMenu");

const elResults = document.getElementById("results");
const elLocal = document.getElementById("localCharges");
const elRemarks = document.getElementById("remarksSection");
const elStatus = document.getElementById("status");

let rates = [];
let localCharges = [];
let remarks = [];

let polOptions = [];
let podOptionsAll = [];
let selectedPODs = new Set();
let currentPOL = "";

// -------------------- Helpers --------------------

function norm(v) { return (v ?? "").toString().trim(); }

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

function setStatus(msg) { elStatus.textContent = msg || ""; }

function pick(obj, keys) {
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  return "";
}

// -------------------- Currency --------------------

function isNA(value) {
  const v = norm(value).toUpperCase();
  return v === "N/A" || v === "NA" || v === "N.A." || v === "-";
}
function looksNumeric(value) { return /\d/.test(String(value ?? "")); }

function normalizeCurrencyDisplay(value) {
  const v = norm(value);
  if (!v) return v;
  if (isNA(v)) return "N/A";

  if (/^(USD|EUR)\s+/i.test(v)) return v.replace(/^(usd|eur)\b/i, m => m.toUpperCase());
  if (v.includes("€")) return `EUR ${v.replace("€", "").trim()}`;
  if (v.includes("$")) return `USD ${v.replace("$", "").trim()}`;

  const m = v.match(/\b(USD|EUR)\b/i);
  if (m) {
    const cur = m[1].toUpperCase();
    const rest = v.replace(/\b(USD|EUR)\b/ig, "").trim();
    return `${cur} ${rest}`.trim();
  }

  if (looksNumeric(v)) return `USD ${v}`;
  return v;
}

// -------------------- Autocomplete --------------------

function setupCombo(inputEl, menuEl, getOptions, onPick) {
  const root = inputEl.closest(".combo");
  const btn = root.querySelector(".combo-btn");

  function open() { root.classList.add("open"); }
  function close() { root.classList.remove("open"); }

  function renderList(values) {
    if (!values.length) {
      menuEl.innerHTML = `<div class="combo-empty">No hay opciones</div>`;
      return;
    }
    menuEl.innerHTML = values.map(v => `<div class="combo-option">${escapeHtml(v)}</div>`).join("");
  }

  function showAll() { renderList(getOptions()); open(); }

  function filter() {
    const q = inputEl.value.toLowerCase();
    const all = getOptions();
    const filtered = !q ? all : all.filter(x => x.toLowerCase().includes(q));
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
    const val = opt.textContent;
    inputEl.value = val;
    onPick?.(val);
    close();
  });

  document.addEventListener("click", e => {
    if (!root.contains(e.target)) close();
  });
}

// -------------------- POD chips --------------------

function ensurePODChipsContainer() {
  const field = elPOD.closest(".field");
  let chips = field.querySelector("#podChips");
  if (!chips) {
    chips = document.createElement("div");
    chips.id = "podChips";
    chips.className = "pod-chips";
    field.appendChild(chips);
  }
  return chips;
}

function renderPODChips() {
  const chips = ensurePODChipsContainer();
  const arr = [...selectedPODs];

  if (!arr.length) {
    chips.innerHTML = "";
    return;
  }

  chips.innerHTML = arr.map(pod => `
    <span class="chip">
      ${escapeHtml(pod)}
      <button type="button" class="chip-x" data-pod="${escapeHtml(pod)}" aria-label="Quitar">×</button>
    </span>
  `).join("");

  chips.querySelectorAll(".chip-x").forEach(btn => {
    btn.addEventListener("click", () => {
      const pod = btn.getAttribute("data-pod");
      selectedPODs.delete(pod);
      renderPODChips();
      triggerAutoSearch();
    });
  });
}

// -------------------- POL -> POD options --------------------

function computePODOptionsForPOL(pol) {
  if (!pol) return podOptionsAll;
  const set = new Set();
  for (const r of rates) if (r.POL === pol && r.POD) set.add(r.POD);
  return uniqueSorted([...set]);
}

function resetPODSelection() {
  selectedPODs.clear();
  elPOD.value = "";
  renderPODChips();
}

function onPOLPicked(pol) {
  if (pol && pol !== currentPOL) {
    currentPOL = pol;
    resetPODSelection(); // ✅ requirement
  }
  triggerAutoSearch();
}

function addSelectedPOD(pod) {
  const pol = norm(elPOL.value);
  if (!pol) return;

  const valid = computePODOptionsForPOL(pol);
  if (!valid.includes(pod)) return;

  selectedPODs.add(pod);
  elPOD.value = "";
  renderPODChips();
  triggerAutoSearch();
}

// -------------------- Results --------------------

function renderResults(rows) {
  if (!rows.length) {
    elResults.innerHTML = `<p class="status">No se encontraron tarifas.</p>`;
    return;
  }

  const headers = ["POL", "POD", "NOR", "20GP", "40HC", "Validez", "Días libres", "Naviera", "Agente"];

  const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;

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
          <tr><th>Concepto</th><th>Detalle</th><th>Cálculo</th><th></th></tr>
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
  remarks.forEach(r => Object.values(r).forEach(val => { const v = norm(val); if (v) lines.push(v); }));

  elRemarks.innerHTML = `<ul class="remarks-list">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
}

// -------------------- Auto-search --------------------

function triggerAutoSearch() {
  const pol = norm(elPOL.value);
  if (!pol) {
    setStatus("Selecciona POL.");
    renderResults([]);
    return;
  }
  if (!selectedPODs.size) {
    setStatus("Selecciona al menos un POD.");
    renderResults([]);
    return;
  }
  onSearch();
}

function onSearch() {
  const pol = norm(elPOL.value);
  const pods = [...selectedPODs];
  const podSet = new Set(pods);

  setStatus(`Mostrando resultados para: ${pol} → ${pods.join(", ")}`);
  const matches = rates.filter(r => r.POL === pol && podSet.has(r.POD));
  renderResults(matches);
}

// -------------------- Load Excel --------------------

async function loadExcel() {
  setStatus("Cargando tarifas...");

  const res = await fetch(EXCEL_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar el archivo: ${EXCEL_PATH}`);

  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const wsRates = workbook.Sheets[SHEET_RATES];
  if (!wsRates) throw new Error(`No existe la hoja "${SHEET_RATES}".`);

  const rawRates = XLSX.utils.sheet_to_json(wsRates, { raw: false, defval: "" });

  rates = rawRates
    .map(r => ({
      POL: norm(pick(r, ["POL", "Pol", "PUERTO DE EMBARQUE"])),
      POD: norm(pick(r, ["POD", "Pod", "PUERTO DE DESTINO"])),
      NOR: norm(pick(r, ["NOR", "Nor"])),
      "20GP": norm(pick(r, ["20GP", "20Gp", "20 GP"])),
      "40HC": norm(pick(r, ["40HC", "40HQ", "40 HQ", "40Hq"])),
      Validez: norm(pick(r, ["VALIDEZ", "Validez", "validez"])),
      "Dias libres": norm(pick(r, ["DIAS LIBRES", "Dias libres", "DÍAS LIBRES", "días libres"])),
      NAVIERA: norm(pick(r, ["NAVIERA", "Naviera", "naviera"])),
      Agente: norm(pick(r, ["AGENTE", "Agente", "agente"]))
    }))
    .filter(x => x.POL || x.POD);

  const wsLocal = workbook.Sheets[SHEET_LOCAL];
  localCharges = wsLocal ? XLSX.utils.sheet_to_json(wsLocal, { raw: false, defval: "" }) : [];

  const wsRemarks = workbook.Sheets[SHEET_REMARKS];
  remarks = wsRemarks ? XLSX.utils.sheet_to_json(wsRemarks, { raw: false, defval: "" }) : [];

  polOptions = uniqueSorted(rates.map(r => r.POL).filter(Boolean));
  podOptionsAll = uniqueSorted(rates.map(r => r.POD).filter(Boolean));

  // reset state
  currentPOL = "";
  elPOL.value = "";
  resetPODSelection();

  ensurePODChipsContainer();
  renderPODChips();

  renderLocalCharges();
  renderRemarks();

  setStatus("Listo.");
}

// -------------------- Init --------------------

// POL: selection triggers reset POD + auto search
setupCombo(elPOL, elPOLMenu, () => polOptions, (pol) => onPOLPicked(pol));

// POD: options depend on selected POL, selection is multi
setupCombo(
  elPOD,
  elPODMenu,
  () => {
    const pol = norm(elPOL.value);
    const valid = computePODOptionsForPOL(pol);
    return valid.filter(p => !selectedPODs.has(p));
  },
  (pod) => addSelectedPOD(pod)
);

// Enter on POD input adds if exact match
elPOD.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const val = norm(elPOD.value);
    if (!val) return;

    const pol = norm(elPOL.value);
    const valid = computePODOptionsForPOL(pol);
    if (valid.includes(val)) addSelectedPOD(val);
  }
});

// If POL typed manually, confirm on blur -> reset POD if changed
elPOL.addEventListener("blur", () => {
  const pol = norm(elPOL.value);
  if (!pol) {
    currentPOL = "";
    resetPODSelection();
    setStatus("Selecciona POL.");
    renderResults([]);
    return;
  }
  if (polOptions.includes(pol)) onPOLPicked(pol);
});

loadExcel().catch((err) => {
  console.error("[RateFinder] Error:", err);
  setStatus(`Error: ${err.message}`);
});
