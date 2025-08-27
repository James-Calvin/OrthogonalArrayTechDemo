// ---------- Utilities ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function downloadJSON(filename, data){
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Simple deterministic PRNG (LCG)
function createPRNG(seedStr){
  let seed = 0;
  for (let i=0;i<seedStr.length;i++) seed = (seed*31 + seedStr.charCodeAt(i)) >>> 0;
  let state = seed || 123456789;
  return function(){
    state = (1664525*state + 1013904223) >>> 0;
    return (state >>> 0) / 0xffffffff;
  };
}

// ---------- L25 (5^6) Generator ----------
// Construction via linear columns mod 5: rows are pairs (i,j), columns are i, j, i+j, i+2j, i+3j, i+4j (mod 5), then +1 to map to 1..5
function generateL25(){
  const rows = [];
  for(let i=0;i<5;i++){
    for(let j=0;j<5;j++){
      const r = [
        i,
        j,
        (i+j)%5,
        (i+2*j)%5,
        (i+3*j)%5,
        (i+4*j)%5
      ].map(x=>x+1);
      rows.push(r);
    }
  }
  return rows; // 25x6, each entry in 1..5
}

// ---------- Default factors (Ad DSP example) ----------
const defaultFactors = [
  { name: 'Bid Strategy', levels: ['Fixed CPC','Target CPA','Max Conversions','Target ROAS','Enhanced CPC'] },
  { name: 'Targeting Strategy', levels: ['Contextual','Behavioral','Lookalike','Keyword','Retargeting'] },
  { name: 'Creative Variant', levels: ['Image A','Image B','Video A','Video B','Carousel'] },
  { name: 'Audience Segment', levels: ['New Visitors','Returning Visitors','High Intent','Cart Abandoners','Loyalty Members'] },
  { name: 'Time of Day', levels: ['Morning','Afternoon','Evening','Night','All Day'] },
  { name: 'Device Platform', levels: ['Mobile Web','In-App','Desktop','Tablet','CTV'] },
];

// State
let design = JSON.parse(JSON.stringify(defaultFactors));
let L25 = [];
let schedule = []; // array of {run, levels: [1..5], labels: [..]}
const kpiTables = []; // { id, name, objective, values: number[25] }

// ---------- Render Design Inputs ----------
function renderDesign(){
  const host = $('#factors');
  host.innerHTML = '';
  design.forEach((f, idx)=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row">
        <div class="grow">
          <label>Factor ${idx+1} name</label>
          <input type="text" value="${escapeHtml(f.name)}" data-factor-name-index="${idx}" class="grow"/>
        </div>
      </div>
      <div class="grid cols-3" style="margin-top:8px">
        ${f.levels.map((lv, i)=>`
          <div>
            <label>Level ${i+1}</label>
            <input type="text" value="${escapeHtml(lv)}" data-factor-level-index="${idx}:${i}" class="grow"/>
          </div>
        `).join('')}
      </div>
    `;
    host.appendChild(card);
  });

  // attach listeners
  $$('input[data-factor-name-index]').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const i = parseInt(e.target.getAttribute('data-factor-name-index'));
      design[i].name = e.target.value || `Factor ${i+1}`;
    });
  });
  $$('input[data-factor-level-index]').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const [fi, li] = e.target.getAttribute('data-factor-level-index').split(':').map(Number);
      design[fi].levels[li] = e.target.value || `Level ${li+1}`;
    });
  });
}

function escapeHtml(str){
  return String(str).replace(/[&<>"]/g, s=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[s]));
}

// ---------- Generate Schedule ----------
function buildSchedule(){
  L25 = generateL25();
  schedule = L25.map((row, i)=>({
    run: i+1,
    levels: row,
    labels: row.map((lv, j)=>design[j].levels[lv-1])
  }));
}

function renderSchedule(){
  const host = $('#schedule-table');
  const header = `
    <thead><tr>
      <th>Run</th>
      ${design.map(f=>`<th>${escapeHtml(f.name)}</th>`).join('')}
    </tr></thead>
  `;
  const body = `
    <tbody>
      ${schedule.map(r=>`<tr>
        <td><span class="code">${r.run}</span></td>
        ${r.labels.map(lbl=>`<td>${escapeHtml(lbl)}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  `;
  host.className = '';
  host.innerHTML = `<div class="card"><div style="overflow:auto"><table>${header}${body}</table></div></div>`;
  $('#btn-export').disabled = false;
  $('#results').setAttribute('aria-disabled','false');
  $('#schedule').setAttribute('aria-disabled','false');
}

// ---------- Results (KPI tables) ----------
let kpiIdCounter = 1;
function addKpiTable(name='CTR (%)', objective='maximize'){
  const id = `kpi-${kpiIdCounter++}`;
  const values = simulateKpiValues(name);
  const kpi = { id, name, objective, values };
  kpiTables.push(kpi);
  renderKpis();
  $('#btn-analyze').disabled = false;
}

function simulateKpiValues(name){
  // Deterministic pseudo simulation from design + L25
  if (schedule.length !== 25) return Array(25).fill(0);
  const rnd = createPRNG('kpi:'+name);
  // weights per factor to create differentiated effects
  const weights = Array(6).fill(0).map((_,i)=> (rnd()*0.25 + 0.05) * (rnd() < 0.5 ? 1 : -1));
  const baseByName = {
    'CTR (%)': 1.5,
    'CVR (%)': 2.2,
    'CPA ($)': 45,
    'ROAS': 1.8
  };
  const scaleByName = {
    'CTR (%)': 0.12,
    'CVR (%)': 0.15,
    'CPA ($)': 3.2,
    'ROAS': 0.25
  };
  const base = baseByName[name] ?? 10;
  const scale = scaleByName[name] ?? 0.5;
  const vals = schedule.map(r=>{
    const centered = r.levels.map(lv=> (lv-3));
    let y = base + centered.reduce((acc,v,idx)=> acc + v * (weights[idx]* (name==='CPA ($)'?-1:1)) * (scale), 0);
    y += (rnd()-0.5) * scale; // small noise
    // Clamp CTR/CVR >= 0
    if (/\(\%\)/.test(name)) y = Math.max(0, y);
    return +y.toFixed(3);
  });
  return vals;
}

function renderKpis(){
  const host = $('#kpi-list');
  host.innerHTML = '';
  kpiTables.forEach(kpi=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div class="grow">
          <label>KPI name</label>
          <input type="text" value="${escapeHtml(kpi.name)}" data-kpi-name="${kpi.id}" class="grow"/>
        </div>
        <div>
          <label>Objective</label><br/>
          <select data-kpi-obj="${kpi.id}">
            <option value="maximize" ${kpi.objective==='maximize'?'selected':''}>Maximize</option>
            <option value="minimize" ${kpi.objective==='minimize'?'selected':''}>Minimize</option>
          </select>
        </div>
      </div>
      <div style="overflow:auto;margin-top:8px">
        <table>
          <thead><tr><th>Run</th><th>Value</th></tr></thead>
          <tbody>
            ${schedule.map((r, idx)=>`<tr>
              <td><span class="code">${r.run}</span></td>
              <td><input type="number" step="any" value="${kpi.values[idx]}" data-kpi-val="${kpi.id}:${idx}"/></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:8px">
        <button class="ghost" data-kpi-remove="${kpi.id}">Remove</button>
      </div>
    `;
    host.appendChild(card);
  });

  // listeners
  $$('input[data-kpi-name]').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const id = e.target.getAttribute('data-kpi-name');
      const k = kpiTables.find(x=>x.id===id); if (k) k.name = e.target.value;
    });
  });
  $$('select[data-kpi-obj]').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const id = e.target.getAttribute('data-kpi-obj');
      const k = kpiTables.find(x=>x.id===id); if (k) k.objective = e.target.value;
    });
  });
  $$('input[data-kpi-val]').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const [id, idx] = e.target.getAttribute('data-kpi-val').split(':');
      const k = kpiTables.find(x=>x.id===id); if (!k) return;
      const v = parseFloat(e.target.value);
      k.values[+idx] = isFinite(v) ? v : 0;
    });
  });
  $$('button[data-kpi-remove]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.target.getAttribute('data-kpi-remove');
      const ix = kpiTables.findIndex(x=>x.id===id);
      if (ix>=0){ kpiTables.splice(ix,1); renderKpis(); }
      $('#btn-analyze').disabled = kpiTables.length===0;
    });
  });
}

// ---------- Analysis ----------
function analyze(){
  const container = $('#analysis-content');
  if (kpiTables.length===0){ container.innerHTML = '<div class="notice">Add a KPI to analyze.</div>'; return; }
  const L = schedule.length; // 25
  const F = design.length; // 6
  const htmlParts = [];

  for (const kpi of kpiTables){
    const y = kpi.values.slice();
    const grand = mean(y);
    const perFactor = [];
    let SS_total = y.reduce((acc,yi)=> acc + (yi-grand)**2, 0);
    let SS_sum = 0;

    for (let f=0; f<F; f++){
      const levelVals = [[],[],[],[],[]];
      for (let i=0;i<L;i++){
        const lv = schedule[i].levels[f]; // 1..5
        levelVals[lv-1].push(y[i]);
      }
      const means = levelVals.map(arr=> mean(arr));
      const n = levelVals.map(arr=> arr.length);
      const SS_f = means.reduce((acc,m,idx)=> acc + n[idx]* (m - grand)**2, 0);
      SS_sum += SS_f;
      const bestIndex = selectBestIndex(means, kpi.objective);
      perFactor.push({ fIndex: f, name: design[f].name, means, SS_f, df: 4, bestIndex });
    }
    const SS_error = Math.max(0, SS_total - SS_sum);
    const df_total = L-1;
    const df_factors = F*(5-1); // 24
    const df_error = Math.max(0, df_total - df_factors);

    const contribRows = perFactor.map(p=>({
      name: p.name,
      SS: p.SS_f,
      df: p.df,
      pct: SS_total>0 ? (p.SS_f/SS_total*100) : 0
    }));

    // Predicted optimum via Taguchi main-effects: y_hat = sum(best_means) - (F-1)*grand
    const sumBestMeans = perFactor.reduce((acc,p)=> acc + p.means[p.bestIndex], 0);
    const yhat = sumBestMeans - (F-1)*grand;

    htmlParts.push(renderKpiAnalysis(kpi, grand, perFactor, contribRows, yhat, SS_total, SS_error, df_error));
  }
  container.innerHTML = htmlParts.join('\n');
  $('#analysis').setAttribute('aria-disabled','false');
}

function renderKpiAnalysis(kpi, grand, perFactor, contribRows, yhat, SS_total, SS_error, df_error){
  const mainEffects = perFactor.map(p=>{
    const levels = p.means.map((m,i)=>({ level: i+1, label: design[p.fIndex].levels[i], mean: m }));
    const chart = sparklineSVG(levels.map(x=>x.mean));
    const bestLbl = `${design[p.fIndex].levels[p.bestIndex]} (L${p.bestIndex+1})`;
    return `
      <div class="card">
        <h4>${escapeHtml(p.name)}</h4>
        <div class="flex">
          <div>
            <div class="hint">Level means</div>
            <table>
              <thead><tr><th>Level</th><th>Setting</th><th>Mean</th></tr></thead>
              <tbody>
                ${levels.map(l=>`<tr><td>L${l.level}</td><td>${escapeHtml(l.label)}</td><td>${l.mean.toFixed(4)}</td></tr>`).join('')}
              </tbody>
            </table>
            <div class="hint" style="margin-top:6px">Best level (${kpi.objective}): <b>${escapeHtml(bestLbl)}</b></div>
          </div>
          <div>
            <div class="hint">Main effect (trend)</div>
            <div class="chart">${chart}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const anovaTable = `
    <table>
      <thead><tr><th>Factor</th><th>df</th><th>SS</th><th>Contribution</th></tr></thead>
      <tbody>
        ${contribRows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.df}</td><td>${r.SS.toFixed(6)}</td><td>${r.pct.toFixed(2)}%</td></tr>`).join('')}
        <tr><td><i>Error</i></td><td>${df_error}</td><td>${SS_error.toFixed(6)}</td><td>${SS_total>0 ? (SS_error/SS_total*100).toFixed(2) : '0.00'}%</td></tr>
        <tr><td><b>Total</b></td><td>24</td><td>${SS_total.toFixed(6)}</td><td>100%</td></tr>
      </tbody>
    </table>
    <div class="hint">Note: L25(5^6) is saturated (no residual df). Use percent contributions; F-tests are not available.</div>
  `;

  const optRows = perFactor.map(p=>{
    const idx = p.bestIndex;
    const lvlName = design[p.fIndex].levels[idx];
    return `<tr><td>${escapeHtml(design[p.fIndex].name)}</td><td>L${idx+1}</td><td>${escapeHtml(lvlName)}</td></tr>`;
  }).join('');

  return `
  <div class="card" style="border-color:#2e3c7e">
    <h3 style="margin:0 0 6px 0">${escapeHtml(kpi.name)}</h3>
    <div class="grid cols-2">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>Grand mean: <b>${grand.toFixed(4)}</b></div>
          <div>Objective: <b>${kpi.objective}</b></div>
        </div>
        <div style="margin-top:8px">Predicted optimum response: <b>${yhat.toFixed(4)}</b></div>
        <div style="margin-top:8px;overflow:auto">
          <table>
            <thead><tr><th>Factor</th><th>Best Level</th><th>Setting</th></tr></thead>
            <tbody>${optRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h4 style="margin:0 0 6px 0">ANOVA (percent contribution)</h4>
        <div style="overflow:auto">${anovaTable}</div>
      </div>
    </div>
    <div style="margin-top:10px">${mainEffects}</div>
  </div>`;
}

function mean(arr){
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}
function selectBestIndex(vals, objective){
  let best = 0;
  for (let i=1;i<vals.length;i++){
    if (objective==='maximize' ? vals[i]>vals[best] : vals[i]<vals[best]) best=i;
  }
  return best;
}

function sparklineSVG(values){
  const w=380, h=140, pad=20;
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const xStep = (w - 2*pad) / (values.length-1);
  const yScale = (v)=>{
    if (max===min) return h/2;
    const t = (v - min) / (max - min);
    return h - pad - t*(h - 2*pad);
  };
  const pts = values.map((v,i)=> [pad + i*xStep, yScale(v)]);
  const path = pts.map((p,i)=> (i?'L':'M')+p[0].toFixed(1)+","+p[1].toFixed(1)).join(' ');
  const circles = pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="${getComputedStyle(document.documentElement).getPropertyValue('--accent-2')}"></circle>`).join('');
  const y0 = yScale(values[0]);
  return `
    <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <rect x="1" y="1" width="${w-2}" height="${h-2}" fill="transparent" stroke="rgba(255,255,255,0.05)"/>
      <path d="${path}" fill="none" stroke="${getComputedStyle(document.documentElement).getPropertyValue('--accent')}" stroke-width="2"/>
      ${circles}
      <text x="${pad}" y="${pad}" fill="#aab3d1" font-size="10" font-family="var(--mono)">min ${min.toFixed(3)} · max ${max.toFixed(3)}</text>
    </svg>`;
}

// ---------- Export ----------
function exportJSON(){
  const payload = {
    meta: { array: 'L25(5^6)', strength: 2, runs: 25, factors: 6, generatedAt: new Date().toISOString() },
    design: design.map(f=>({ name: f.name, levels: f.levels.slice() })),
    schedule: schedule.map(r=>({ run: r.run, levels: r.levels.slice(), labels: r.labels.slice() })),
    results: kpiTables.map(k=>({ name: k.name, objective: k.objective, values: k.values.slice() }))
  };
  downloadJSON('experiment-L25.json', payload);
}

// ---------- Wiring ----------
$('#btn-generate').addEventListener('click', ()=>{
  buildSchedule();
  renderSchedule();
  // Reset KPIs and seed with examples
  kpiTables.length = 0;
  addKpiTable('CTR (%)','maximize');
  addKpiTable('CPA ($)','minimize');
  $('#results').setAttribute('aria-disabled','false');
  $('#btn-analyze').disabled = false;
});
$('#btn-export').addEventListener('click', exportJSON);
$('#btn-add-kpi').addEventListener('click', ()=> addKpiTable('New KPI','maximize'));
$('#btn-analyze').addEventListener('click', analyze);

// Initial render
renderDesign();

