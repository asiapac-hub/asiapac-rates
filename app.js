// app.js (FULL) — robust Excel parsing + debug logs + 40HQ/40HC support + Local Charges table + Remarks bullets
// -----------------------------------------------------------------------------------------------------------

const EXCEL_PATH = "data/tarifas.xlsx";
const SHEET_RATES = "RATES";
const SHEET_LOCAL = "GASTOS_LOCALES";
const SHEET_REMARKS = "REMARKS";

// UI elements
const elPOL = document.getElementById("pol");
const elPOD = document.getElementById("pod");
const elBtn = document.getElementById("searchBtn");
const elResults = document.getElementById("results");
const elLocal = document.getElementById("localCharges");
const elRemarks = document.getElementById("remarksSection");
const elStatus = document.getElementById("status");

// Data holders
let rates = [];
let localCharges = [];
let remarks = [];

// -------------------- helpers --------------------

function norm(v) {
  return (v ?? "").toString().trim();
}

/**
 * Normalize header keys:
 * - Unicode normalize
 * - Replace NBSP
 * - Replace punctuation/symbols with spaces
 * - Collapse whitespace
 * - Lowercase
 */
function normKey(k) {
  return String(k ?? "")
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    .replace(/[^\w\d]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setStatus(msg) {
  elStatus.textContent = msg || "";
}

function safeNOR(value) {
  const v = norm(value);
  return v === "" ? "N/A" : v;
}

// -------------------- rendering --------------------

function renderSelect(selectEl, values, placeholder) {
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function renderResults(rows) {
  if (!rows.length) {
    elResults.innerHTML = `<p class="status">No se encontraron tarifas para esa combinación.</p>`;
    return;
  }

  // ✅ Visual header fix: "NAVIERA" -> "Naviera"
  const headers = ["POL", "POD", "NOR", "20GP", "40HC", "Validez", "Dias libres", "Naviera", "Agente"];

  const thead = `
    <thead>
      <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${rows
        .map(
          (r) => `
        <tr>
          <td>${norm(r.POL)}</td>
          <td>${norm(r.POD)}</td>
          <!-- ✅ NOR now renders as plain text (same style as 20GP/40HC) -->
          <td>${safeNOR(r.NOR)}</td>
          <td>${norm(r["20GP"])}</td>
          <td>${norm(r["40HC"])}</td>
          <td>${norm(r.Validez)}</td>
          <td>${norm(r["Dias libres"])}</td>
          <td>${norm(r.NAVIERA)}</td>
          <td>${norm(r.Agente)}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;

  // Responsive: wrap table so it scrolls horizontally on mobile
  elResults.innerHTML = `<div class="table-wrap"><table class="table">${thead}${tbody}</table></div>`;
}

// -------------------- Local charges (TABLE + CÁLCULO + IVA badge) --------------------

function renderLocalCharges() {
  if (!localCharges.length) {
    elLocal.innerHTML = `<p class="status">No se encontraron gastos locales en la hoja "${SHEET_LOCAL}".</p>`;
    return;
  }

  // helper: pick by possible keys
  const pick = (obj, keys) => {
    for (const k of keys) {
      if (k in obj) return obj[k];
    }
    return "";
  };

  const s = (v) => (v ?? "").toString().trim();

  // Normalize IVA indicator to "+ IVA" or "N/A"
  const ivaBadge = (v) => {
    const raw = s(v);
    const low = raw.toLowerCase();

    if (!low) return "N/A";
    if (low.includes("+ iva")) return "+ IVA";
    if (low === "iva") return "+ IVA";
    if (low === "si" || low === "sí" || low === "yes" || low === "true" || low === "1") return "+ IVA";
    if (low === "n/a" || low === "na" || low === "no" || low === "false" || low === "0") return "N/A";
    if (low.includes("iva")) return "+ IVA";

    return raw || "N/A";
  };

  const rows = localCharges
    .map((r) => {
      const Concepto = s(pick(r, ["Concepto", "CONCEPTO", "concepto"]));
      const Detalle = s(pick(r, ["Detalle", "DETALLE", "detalle"]));
      const Calculo = s(pick(r, ["Cálculo", "CÁLCULO", "CALCULO", "calculo", "cálculo"]));

      // IVA indicator column (multiple possible names)
      const IVAraw = pick(r, ["IVA", "iva", "+ IVA", "+iva", "APLICA IVA", "Aplica IVA", "IMPUTA IVA", "Imputa IVA"]);

      return { Concepto, Detalle, Calculo, IVA: ivaBadge(IVAraw) };
    })
    .filter((x) => x.Concepto || x.Detalle || x.Calculo);

  if (!rows.length) {
    elLocal.innerHTML = `<p class="status">La hoja "${SHEET_LOCAL}" no contiene filas legibles.</p>`;
    return;
  }

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
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${r.Concepto}</td>
              <td>${r.Detalle}</td>
              <td>${r.Calculo}</td>
              <td><span class="badge">${r.IVA}</span></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// -------------------- Remarks (bullet points) --------------------

function renderRemarks() {
  if (!elRemarks) return; // if section not present in index.html, just skip

  if (!remarks || !remarks.length) {
    elRemarks.innerHTML = `<p class="status">No remarks available.</p>`;
    return;
  }

  // Flatten any cell values into bullet lines (supports 1-column or multi-column sheets)
  const lines = [];
  for (const row of remarks) {
    for (const val of Object.values(row)) {
      const v = norm(val);
      if (v) lines.push(v);
    }
  }

  if (!lines.length) {
    elRemarks.innerHTML = `<p class="status">No remarks available.</p>`;
    return;
  }

  elRemarks.innerHTML = `
    <ul class="remarks-list">
      ${lines.map((line) => `<li>${line}</li>`).join("")}
    </ul>
  `;
}

// -------------------- parsing logic --------------------

function buildHeaderMap(rawHeaders) {
  const headerMap = {};
  rawHeaders.forEach((h, idx) => {
    const nk = normKey(h);
    if (nk) headerMap[nk] = idx;
  });
  return headerMap;
}

/**
 * Find a column index by checking if the normalized header contains ALL tokens.
 */
function findIdxByContains(headerMap, tokens) {
  const keys = Object.keys(headerMap);
  const want = tokens.map((t) => normKey(t));
  for (const k of keys) {
    const ok = want.every((t) => k.includes(t));
    if (ok) return headerMap[k];
  }
  return undefined;
}

function getFieldFromRow(rowArr, headerMap, possibleNames, containsFallbackTokens = []) {
  // Try aliases (direct/normalized)
  for (const name of possibleNames) {
    const idx = headerMap[normKey(name)];
    if (typeof idx !== "undefined") {
      return norm(rowArr[idx]);
    }
  }

  // Try "contains tokens" fallback
  if (containsFallbackTokens.length) {
    const idx = findIdxByContains(headerMap, containsFallbackTokens);
    if (typeof idx !== "undefined") {
      return norm(rowArr[idx]);
    }
  }

  return "";
}

/**
 * Locate header row if sheet has title rows above table.
 * Searches for a row containing POL and POD (or synonyms).
 */
function findHeaderRowIndex(rawMatrix, maxScanRows = 25) {
  const synonymsPOL = ["pol", "puerto de embarque", "puerto embarque", "puerto origen", "origen"];
  const synonymsPOD = ["pod", "puerto de destino", "puerto destino", "destino"];

  const limit = Math.min(rawMatrix.length, maxScanRows);
  for (let i = 0; i < limit; i++) {
    const row = rawMatrix[i] || [];
    const normed = row.map((c) => normKey(c));
    const hasPOL = normed.some((x) => synonymsPOL.map(normKey).includes(x));
    const hasPOD = normed.some((x) => synonymsPOD.map(normKey).includes(x));
    if (hasPOL && hasPOD) return i;
  }
  return 0;
}

async function loadExcel() {
  setStatus("Cargando tarifas desde Excel...");
  elBtn.disabled = true;

  const res = await fetch(EXCEL_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar el archivo: ${EXCEL_PATH}`);

  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  // ---------------- RATES ----------------
  const wsRates = workbook.Sheets[SHEET_RATES];
  if (!wsRates) {
    console.error("[RateFinder] Hojas disponibles:", workbook.SheetNames);
    throw new Error(`No existe la hoja "${SHEET_RATES}". Hojas disponibles: ${workbook.SheetNames.join(", ")}`);
  }

  const raw = XLSX.utils.sheet_to_json(wsRates, { header: 1, defval: "" });

  console.group("[RateFinder][DEBUG] Excel parse");
  console.log("SheetNames:", workbook.SheetNames);
  console.log("RATES raw rows:", raw.length);

  if (!raw || raw.length < 2) {
    console.warn("[RateFinder] Hoja RATES vacía o insuficiente.");
    rates = [];
  } else {
    const headerRowIdx = findHeaderRowIndex(raw);
    const rawHeaders = (raw[headerRowIdx] || []).map((h) => String(h ?? "").trim());
    const headerMap = buildHeaderMap(rawHeaders);

    console.log("HeaderRowIdx:", headerRowIdx);
    console.log("RAW HEADERS:", rawHeaders);
    console.log("NORMALIZED HEADERS:", rawHeaders.map(normKey));
    console.log("HEADER MAP:", headerMap);

    const aliases = {
      POL: ["POL", "PUERTO DE EMBARQUE", "PUERTO EMBARQUE", "PUERTO ORIGEN", "ORIGEN"],
      POD: ["POD", "PUERTO DE DESTINO", "PUERTO DESTINO", "DESTINO"],
      NOR: ["NOR", "NON OPERATIVE REEFER", "NON OPPERATIVE REEFER"],

      "20GP": ["20GP", "20 GP", "20'GP", "20'", "20FT", "20 FT"],

      // Support both 40HC and 40HQ (your excel uses 40HQ)
      "40HC": ["40HC", "40 HC", "40'HC", "40' HC", "40HQ", "40 HQ", "40'HQ", "40' HQ", "40FT HC", "40FT HQ"],

      Validez: ["VALIDEZ", "VALIDEZ TARIFA", "VALIDITY", "VALID"],
      "Dias libres": ["DIAS LIBRES", "DÍAS LIBRES", "DIAS LIBRES DESTINO", "FREE DAYS"],
      NAVIERA: ["NAVIERA", "LINEA", "LÍNEA", "CARRIER"],
      Agente: ["AGENTE", "AGENTE ORIGEN", "FREIGHT FORWARDER", "FORWARDER", "EMBARCADOR", "SHIPPER AGENT"],
    };

    const rows = raw.slice(headerRowIdx + 1);

    rates = rows
      .map((rowArr) => ({
        POL: getFieldFromRow(rowArr, headerMap, aliases.POL, ["pol"]),
        POD: getFieldFromRow(rowArr, headerMap, aliases.POD, ["pod"]),
        NOR: getFieldFromRow(rowArr, headerMap, aliases.NOR, ["nor"]),

        "20GP": getFieldFromRow(rowArr, headerMap, aliases["20GP"], ["20", "gp"]),

        // "40HC" field uses excel column 40HQ/40HC whichever exists
        "40HC":
          getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40", "hc"]) ||
          getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40", "hq"]) ||
          getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40hc"]) ||
          getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40hq"]),

        Validez: getFieldFromRow(rowArr, headerMap, aliases.Validez, ["validez"]),
        "Dias libres": getFieldFromRow(rowArr, headerMap, aliases["Dias libres"], ["dias", "libres"]),
        NAVIERA: getFieldFromRow(rowArr, headerMap, aliases.NAVIERA, ["naviera"]),
        Agente: getFieldFromRow(rowArr, headerMap, aliases.Agente, ["agente"]),
      }))
      .filter((r) => r.POL || r.POD);

    console.log("Parsed rates length:", rates.length);
    console.log("Parsed sample (first 10):", rates.slice(0, 10));

    const any40 = rates.some((r) => norm(r["40HC"]) !== "");
    console.log("Any 40HC/HQ values detected?:", any40);

    if (!any40) {
      const candidates = Object.keys(headerMap).filter((k) => k.includes("40"));
      console.warn("No se detectó 40HC/HQ. Headers que contienen '40':", candidates);
    }
  }

  // ---------------- LOCAL CHARGES ----------------
  const wsLocal = workbook.Sheets[SHEET_LOCAL];
  if (wsLocal) {
    localCharges = XLSX.utils.sheet_to_json(wsLocal, { defval: "" });
    console.log(`[RateFinder] Local charges rows: ${localCharges.length}`);
  } else {
    localCharges = [];
    console.warn(`[RateFinder] No existe hoja "${SHEET_LOCAL}" (opcional).`);
  }

  // ---------------- REMARKS ----------------
  const wsRemarks = workbook.Sheets[SHEET_REMARKS];
  if (wsRemarks) {
    remarks = XLSX.utils.sheet_to_json(wsRemarks, { defval: "" });
    console.log(`[RateFinder] Remarks rows: ${remarks.length}`);
  } else {
    remarks = [];
    console.warn(`[RateFinder] No existe hoja "${SHEET_REMARKS}".`);
  }

  console.groupEnd();

  // Populate dropdowns
  const pols = uniqueSorted(rates.map((r) => r.POL).filter(Boolean));
  const pods = uniqueSorted(rates.map((r) => r.POD).filter(Boolean));

  renderSelect(elPOL, pols, "Selecciona POL");
  renderSelect(elPOD, pods, "Selecciona POD");

  renderLocalCharges();
  renderRemarks();

  setStatus(`Listo. Tarifas cargadas: ${rates.length}`);
  elBtn.disabled = false;
}

function onSearch() {
  const pol = norm(elPOL.value);
  const pod = norm(elPOD.value);

  if (!pol || !pod) {
    setStatus("Selecciona POL y POD para buscar.");
    renderResults([]);
    return;
  }

  setStatus(`Mostrando resultados para: ${pol} → ${pod}`);

  const matches = rates.filter((r) => r.POL === pol && r.POD === pod);

  console.group("[RateFinder][DEBUG] Search");
  console.log("POL:", pol);
  console.log("POD:", pod);
  console.log("Matches:", matches.length);
  console.log(matches);
  console.groupEnd();

  renderResults(matches);
}

elBtn.addEventListener("click", onSearch);

loadExcel().catch((err) => {
  console.error("[RateFinder] Error loading Excel:", err);
  setStatus(`Error: ${err.message}`);
  elResults.innerHTML = `<p class="status">No se pudo cargar el Excel. Revisa la consola del navegador (F12) y la ruta del archivo.</p>`;
  elBtn.disabled = true;
});
