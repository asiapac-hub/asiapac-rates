const EXCEL_PATH = "data/tarifas.xlsx";
const SHEET_RATES = "RATES";
const SHEET_LOCAL = "GASTOS_LOCALES";

const elPOL = document.getElementById("pol");
const elPOD = document.getElementById("pod");
const elBtn = document.getElementById("searchBtn");
const elResults = document.getElementById("results");
const elLocal = document.getElementById("localCharges");
const elStatus = document.getElementById("status");

let rates = [];        // filas de RATES
let localCharges = []; // filas de GASTOS_LOCALES

function norm(v){
  return (v ?? "").toString().trim();
}

function uniqueSorted(values){
  return [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}

function setStatus(msg){
  elStatus.textContent = msg || "";
}

function renderSelect(selectEl, values, placeholder){
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  values.forEach(v=>{
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function safeNOR(value){
  const v = norm(value);
  return v === "" ? "N/A" : v; // si viene vacío -> N/A
}

function renderResults(rows){
  if (!rows.length){
    elResults.innerHTML = `<p class="status">No se encontraron tarifas para esa combinación.</p>`;
    return;
  }

  const headers = [
    "POL","POD","NOR","20GP","40HC","Validez","Dias libres","NAVIERA","Agente"
  ];

  const thead = `
    <thead>
      <tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${rows.map(r=>`
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
      `).join("")}
    </tbody>
  `;

  elResults.innerHTML = `<table class="table">${thead}${tbody}</table>`;
}

function renderLocalCharges(){
  if (!localCharges.length){
    elLocal.innerHTML = `<p class="status">No se encontraron gastos locales en la hoja "${SHEET_LOCAL}".</p>`;
    return;
  }

  // Si la hoja viene como tabla Concepto/Detalle:
  const hasConcepto = localCharges.some(r => "Concepto" in r || "Detalle" in r);

  if (hasConcepto){
    const rows = localCharges
      .map(r => ({
        Concepto: norm(r.Concepto),
        Detalle: norm(r.Detalle)
      }))
      .filter(r => r.Concepto || r.Detalle);

    elLocal.innerHTML = `
      <table class="table">
        <thead><tr><th>Concepto</th><th>Detalle</th></tr></thead>
        <tbody>
          ${rows.map(r=>`<tr><td>${r.Concepto}</td><td>${r.Detalle}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    return;
  }

  // Si viene como texto suelto en una columna:
  const lines = [];
  for (const r of localCharges){
    for (const k of Object.keys(r)){
      const v = norm(r[k]);
      if (v) lines.push(v);
    }
  }

  elLocal.innerHTML = `<ul>${lines.map(x=>`<li>${x}</li>`).join("")}</ul>`;
}

async function loadExcel(){
  setStatus("Cargando tarifas desde Excel...");
  elBtn.disabled = true;

  const res = await fetch(EXCEL_PATH);
  if (!res.ok) throw new Error(`No se pudo cargar el archivo: ${EXCEL_PATH}`);

  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  // RATES
  const wsRates = workbook.Sheets[SHEET_RATES];
  if (!wsRates) throw new Error(`No existe la hoja "${SHEET_RATES}".`);

  rates = XLSX.utils.sheet_to_json(wsRates, { defval: "" })
    .map(r => ({
      POL: norm(r.POL),
      POD: norm(r.POD),
      NOR: norm(r.NOR),
      "20GP": norm(r["20GP"]),
      "40HC": norm(r["40HC"]),
      Validez: norm(r.Validez),
      "Dias libres": norm(r["Dias libres"]),
      NAVIERA: norm(r.NAVIERA),
      Agente: norm(r.Agente),
    }))
    .filter(r => r.POL && r.POD); // filas válidas

  // GASTOS_LOCALES (opcional)
  const wsLocal = workbook.Sheets[SHEET_LOCAL];
  if (wsLocal){
    localCharges = XLSX.utils.sheet_to_json(wsLocal, { defval: "" });
  } else {
    localCharges = [];
  }

  // Dropdowns
  const pols = uniqueSorted(rates.map(r=>r.POL));
  const pods = uniqueSorted(rates.map(r=>r.POD));

  renderSelect(elPOL, pols, "Selecciona POL");
  renderSelect(elPOD, pods, "Selecciona POD");

  renderLocalCharges();

  setStatus(`Listo. Tarifas cargadas: ${rates.length}`);
  elBtn.disabled = false;
}

function onSearch(){
  const pol = norm(elPOL.value);
  const pod = norm(elPOD.value);

  if (!pol || !pod){
    setStatus("Selecciona POL y POD para buscar.");
    renderResults([]);
    return;
  }

  setStatus(`Mostrando resultados para: ${pol} → ${pod}`);
  const matches = rates.filter(r => r.POL === pol && r.POD === pod);
  renderResults(matches);
}

elBtn.addEventListener("click", onSearch);

loadExcel().catch(err=>{
  console.error(err);
  setStatus(`Error: ${err.message}`);
  elResults.innerHTML = `<p class="status">No se pudo cargar el Excel. Revisa la consola del navegador y la ruta del archivo.</p>`;
  elBtn.disabled = true;
});
