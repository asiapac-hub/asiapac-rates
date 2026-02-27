// app.js (FULL) — robust Excel parsing + debug logs + contains fallback
// --------------------------------------------------

const EXCEL_PATH = "data/tarifas.xlsx";
const SHEET_RATES = "RATES";
const SHEET_LOCAL = "GASTOS_LOCALES";

// UI elements
const elPOL = document.getElementById("pol");
const elPOD = document.getElementById("pod");
const elBtn = document.getElementById("searchBtn");
const elResults = document.getElementById("results");
const elLocal = document.getElementById("localCharges");
const elStatus = document.getElementById("status");

// Data holders
let rates = [];
let localCharges = [];

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

// -------------------- rendering --------------------

function renderResults(rows) {
  if (!rows.length) {
    elResults.innerHTML = `<p class="status">No se encontraron tarifas para esa combinación.</p>`;
    return;
  }

  const headers = ["POL", "POD", "NOR", "20GP", "40HC", "Validez", "Dias libres", "NAVIERA", "Agente"];

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
          <td><span class="badge">${safeNOR(r.NOR)}</span></td>
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

  elResults.innerHTML = `<div class="table-wrap"><table class="table">${thead}${tbody}</table></div>`;
}

function renderLocalCharges() {
  if (!localCharges.length) {
    elLocal.innerHTML = `<p class="status">No se encontraron gastos locales en la hoja "${SHEET_LOCAL}".</p>`;
    return;
  }

  const hasConcepto = localCharges.some(
    (r) => "Concepto" in r || "Detalle" in r || "CONCEPTO" in r || "DETALLE" in r
  );

  if (hasConcepto) {
    const rows = localCharges
      .map((r) => ({
        Concepto: norm(r.Concepto ?? r.CONCEPTO),
        Detalle: norm(r.Detalle ?? r.DETALLE),
      }))
      .filter((r) => r.Concepto || r.Detalle);

    elLocal.innerHTML = `
      <table class="table">
        <thead><tr><th>Concepto</th><th>Detalle</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${r.Concepto}</td><td>${r.Detalle}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    return;
  }

  const lines = [];
  for (const r of localCharges) {
    for (const k of Object.keys(r)) {
      const v = norm(r[k]);
      if (v) lines.push(v);
    }
  }

  elLocal.innerHTML = `<ul>${lines.map((x) => `<li>${x}</li>`).join("")}</ul>`;
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
 * Example tokens: ["40","hc"] or ["40hc"].
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
  // 1) Try aliases exact/normalized
  for (const name of possibleNames) {
    const idx = headerMap[normKey(name)];
    if (typeof idx !== "undefined") {
      const v = norm(rowArr[idx]);
      if (v !== "") return v;
      return ""; // column exists but cell is empty
    }
  }

  // 2) If not found by aliases, try "contains tokens" fallback
  if (containsFallbackTokens.length) {
    const idx = findIdxByContains(headerMap, containsFallbackTokens);
    if (typeof idx !== "undefined") {
      const v = norm(rowArr[idx]);
      if (v !== "") return v;
      return "";
    }
  }

  return "";
}

/**
 * Attempt to locate header row when sheet has titles above.
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

    // Aliases base (por nombre). El fallback "contains" cubrirá headers con texto extra.
    const aliases = {
      POL: ["POL", "PUERTO DE EMBARQUE", "PUERTO EMBARQUE", "PUERTO ORIGEN", "ORIGEN"],
      POD: ["POD", "PUERTO DE DESTINO", "PUERTO DESTINO", "DESTINO"],
      NOR: ["NOR", "NON OPERATIVE REEFER", "NON OPPERATIVE REEFER"],

      "20GP": ["20GP", "20 GP", "20'GP", "20'", "20FT", "20 FT"],
      // Nota: muchos usan HQ en vez de HC
      "40HC": ["40HC", "40 HC", "40'HC", "40' HC", "40HQ", "40 HQ", "40'HQ", "40' HQ", "40FT HC", "40FT HQ"],

      Validez: ["VALIDEZ", "VALIDEZ TARIFA", "VALIDITY", "VALID"],
      "Dias libres": ["DIAS LIBRES", "DÍAS LIBRES", "DIAS LIBRES DESTINO", "FREE DAYS"],
      NAVIERA: ["NAVIERA", "LINEA", "LÍNEA", "CARRIER"],
      Agente: ["AGENTE", "AGENTE ORIGEN", "FREIGHT FORWARDER", "FORWARDER", "EMBARCADOR", "SHIPPER AGENT"],
    };

    const rows = raw.slice(headerRowIdx + 1);

    rates = rows
      .map((rowArr) => {
        const row = {
          POL: getFieldFromRow(rowArr, headerMap, aliases.POL, ["pol"]),
          POD: getFieldFromRow(rowArr, headerMap, aliases.POD, ["pod"]),
          NOR: getFieldFromRow(rowArr, headerMap, aliases.NOR, ["nor"]),

          // containsFallbackTokens: esto captura headers tipo "40HC (USD)" o "40HQ ALL IN"
          "20GP": getFieldFromRow(rowArr, headerMap, aliases["20GP"], ["20", "gp"]),
          "40HC": getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40", "hc"]) ||
                  getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40", "hq"]) ||
                  getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40hc"]) ||
                  getFieldFromRow(rowArr, headerMap, aliases["40HC"], ["40hq"]),

          Validez: getFieldFromRow(rowArr, headerMap, aliases.Validez, ["validez"]),
          "Dias libres": getFieldFromRow(rowArr, headerMap, aliases["Dias libres"], ["dias", "libres"]),
          NAVIERA: getFieldFromRow(rowArr, headerMap, aliases.NAVIERA, ["naviera"]),
          Agente: getFieldFromRow(rowArr, headerMap, aliases.Agente, ["agente"]),
        };
        return row;
      })
      .filter((r) => r.POL || r.POD);

    console.log("Parsed rates length:", rates.length);
    console.log("Parsed sample (first 10):", rates.slice(0, 10));

    // Extra debug: detect if 40HC column was ever found
    const any40 = rates.some((r) => norm(r["40HC"]) !== "");
    console.log("Any 40HC values detected?:", any40);

    if (!any40) {
      // show potential headers that contain "40"
      const candidates = Object.keys(headerMap).filter((k) => k.includes("40"));
      console.warn("No se detectó 40HC/HQ. Headers que contienen '40':", candidates);
    }
  }

  console.groupEnd();

  // ---------------- LOCAL CHARGES ----------------
  const wsLocal = workbook.Sheets[SHEET_LOCAL];
  if (wsLocal) {
    localCharges = XLSX.utils.sheet_to_json(wsLocal, { defval: "" });
    console.log(`[RateFinder] Local charges rows: ${localCharges.length}`);
  } else {
    localCharges = [];
    console.warn(`[RateFinder] No existe hoja "${SHEET_LOCAL}" (opcional).`);
  }

  // ---------------- Populate dropdowns ----------------
  const pols = uniqueSorted(rates.map((r) => r.POL).filter(Boolean));
  const pods = uniqueSorted(rates.map((r) => r.POD).filter(Boolean));

  renderSelect(elPOL, pols, "Selecciona POL");
  renderSelect(elPOD, pods, "Selecciona POD");

  renderLocalCharges();

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
