/* Suivi — panneau. Logique client.
 *
 * Architecture : la saisie est du JS pur et repond instantanement. Pyodide
 * (Python en WebAssembly) n'est charge QUE si l'onglet Analyse ou Perfs est
 * ouvert. C'est ce qui rend le compromis tenable : la saisie quotidienne ne
 * paie jamais le cout de demarrage du moteur, et l'analyse — hebdomadaire —
 * peut se permettre 1 a 2 secondes.
 *
 * Le moteur charge est energie.py / perfs.py, a l'identique de l'appli Mac.
 * Aucune logique metier n'est reimplementee ici.
 */

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const KEY = "suivi_coach_v1";
const CHAMPS = ["poids","pas","calories","sommeil_h","proteines","glucides",
                "lipides","cardio","seance","seance_min","energie","faim"];

let DB = {entries:{}, seances:[], settings:{}};
let pyodide = null, pyLoading = null, ANA = null;
let jour = new Date().toISOString().slice(0,10);

/* ---------- Stockage ---------- */
function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw) DB = JSON.parse(raw);
  }catch(e){ console.error("lecture", e); }
  DB.entries = DB.entries || {}; DB.seances = DB.seances || [];
  DB.settings = DB.settings || {};
}
function save(){
  try{ localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch(e){ toast("Stockage plein — exporte !", true); }
  stats();
}
function stats(){
  $("s-jours").textContent = Object.keys(DB.entries).length;
  $("s-seances").textContent = DB.seances.length;
  $("s-taille").textContent = Math.round(JSON.stringify(DB).length/1024) + " Ko";
}
const $ = id => document.getElementById(id);

/* ---------- Saisie ---------- */
function chargeJour(){
  $("d-jour").value = jour;
  const d = new Date(jour+"T12:00:00");
  $("jour-lbl").textContent = d.toLocaleDateString("fr-FR",
      {weekday:"short", day:"2-digit", month:"2-digit"}).toUpperCase();
  const e = DB.entries[jour] || {};
  CHAMPS.forEach(c=>{
    const el = $("f-"+c);
    el.value = (e[c] !== undefined && e[c] !== null) ? e[c] : "";
    el.parentElement.classList.toggle("set", e[c] !== undefined);
  });
  $("led-jour").className = "led " + (e.poids !== undefined ? "led-nominal" : "led-off");
}
function ecrit(c, v){
  const e = DB.entries[jour] || (DB.entries[jour] = {});
  if(v === "" || v === null){ delete e[c]; }
  else { e[c] = (c === "seance") ? v : parseFloat(v); }
  if(Object.keys(e).length === 0) delete DB.entries[jour];
  save();
  $("f-"+c).parentElement.classList.toggle("set", v !== "");
  $("led-jour").className = "led " + ((DB.entries[jour]||{}).poids !== undefined
      ? "led-nominal" : "led-off");
  ANA = null;                       // l'analyse doit etre recalculee
}
function decale(n){
  const d = new Date(jour+"T12:00:00"); d.setDate(d.getDate()+n);
  jour = d.toISOString().slice(0,10); chargeJour();
}

/* ---------- Pyodide, charge paresseusement ---------- */
async function moteur(){
  if(pyodide) return pyodide;
  if(pyLoading) return pyLoading;
  pyLoading = (async ()=>{
    if(!window.loadPyodide){
      await new Promise((ok,ko)=>{
        const s = document.createElement("script");
        s.src = PYODIDE_URL + "pyodide.js";
        s.onload = ok;
        s.onerror = ()=>ko(new Error(
          "Pyodide n'a pas pu etre telecharge depuis " + PYODIDE_URL +
          " — verifie la connexion au premier lancement."));
        document.head.appendChild(s);
      });
    }
    const py = await loadPyodide({indexURL: PYODIDE_URL});
    // Aucun paquet a installer : le moteur est en stdlib pure. C'est
    // precisement pourquoi numpy a ete retire.
    //
    // Le source vient de engine.js, embarque. La version precedente le
    // telechargeait avec fetch() sans verifier response.ok : une 404
    // renvoyait une page HTML que j'ecrivais dans bridge.py, et Pyodide
    // tentait d'executer du CSS comme du Python. Plus de fetch, plus de
    // chemin relatif, plus de 404 possible.
    if(!window.ENGINE) throw new Error(
      "engine.js absent. Il doit etre a cote de index.html et charge avant app.js.");
    for(const f of window.ENGINE.modules){
      const src = window.ENGINE.src[f];
      if(typeof src !== "string" || !src.length)
        throw new Error("Module manquant dans engine.js : " + f);
      py.FS.writeFile(f + ".py", src);
    }
    py.runPython("import sys; sys.path.insert(0,'')");
    pyodide = py; return py;
  })();
  return pyLoading;
}
async function analyse(){
  if(ANA) return ANA;
  const py = await moteur();
  const payload = JSON.stringify({...DB, fenetre:28,
      cible_pct: DB.settings.cible_pct ?? 0.25});
  py.globals.set("_payload", payload);
  const out = py.runPython("import bridge; bridge.analyser(_payload)");
  ANA = JSON.parse(out);
  return ANA;
}

/* ---------- Rendu : helpers ---------- */
// Le moteur peut renvoyer null la ou Python avait NaN (R2 d'une serie plate).
// Les deux helpers doivent l'absorber sans lever.
const nul = v => v === null || v === undefined || Number.isNaN(v);
const f   = (v,n=1)=> nul(v) ? "—" : Number(v).toFixed(n);
const sgn = (v,n=2)=> nul(v) ? "—" : (v>=0?"+":"") + Number(v).toFixed(n);
const esc = s => String(s).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

function toast(m, err){
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = m;
  if(err) t.style.background = "var(--alarm)", t.style.color = "#1A0505";
  document.body.appendChild(t); setTimeout(()=>t.remove(), 2600);
}

/* ---------- SIGNATURE : la jauge de tolerance ----------
 * L'idee centrale de toute l'appli : une mesure a une incertitude. En salle
 * de controle, ca s'appelle une bande de tolerance autour d'une consigne.
 * Tant que la consigne est DANS la bande mesuree, les donnees ne savent pas
 * les distinguer — donc on ne touche a rien. La jauge rend cette decision
 * lisible en une seconde.
 */
function jauge(t, v){
  const W=340, H=104, PAD=18, y=52;
  const vals = [t.bas, t.haut, v.cible, 0];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const marge = Math.max((hi-lo)*0.28, 0.12); lo -= marge; hi += marge;
  const X = u => PAD + (u-lo)/(hi-lo)*(W-2*PAD);
  const etat = v.etat === "nominal" ? "nominal" : "alarm";
  const col = etat === "nominal" ? "var(--nominal)" : "var(--alarm)";
  const ticks = [];
  const step = (hi-lo)/4;
  for(let i=0;i<=4;i++){ const u = lo+i*step; ticks.push(
    `<line x1="${X(u)}" y1="${y+16}" x2="${X(u)}" y2="${y+21}" stroke="var(--rule-2)"/>
     <text x="${X(u)}" y="${y+34}" fill="var(--dimmer)" font-size="9"
       font-family="var(--mono)" text-anchor="middle">${sgn(u,2)}</text>`); }
  return `<svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Bande de tolerance de la pente mesuree face a la consigne">
    <line x1="${PAD}" y1="${y+16}" x2="${W-PAD}" y2="${y+16}" stroke="var(--rule)"/>
    ${ticks.join("")}
    ${lo<0&&hi>0?`<line x1="${X(0)}" y1="${y-22}" x2="${X(0)}" y2="${y+16}"
       stroke="var(--rule-2)" stroke-dasharray="2 3"/>`:""}
    <!-- bande de tolerance = IC 95% de la pente -->
    <rect x="${X(t.bas)}" y="${y-13}" width="${Math.max(X(t.haut)-X(t.bas),2)}"
      height="26" fill="${col}" opacity=".17" rx="2"/>
    <line x1="${X(t.bas)}" y1="${y-13}" x2="${X(t.bas)}" y2="${y+13}"
      stroke="${col}" stroke-width="1.5"/>
    <line x1="${X(t.haut)}" y1="${y-13}" x2="${X(t.haut)}" y2="${y+13}"
      stroke="${col}" stroke-width="1.5"/>
    <!-- valeur mesuree -->
    <circle cx="${X(t.pente_sem)}" cy="${y}" r="4.5" fill="var(--measure)"/>
    <text x="${X(t.pente_sem)}" y="${y-19}" fill="var(--measure)" font-size="10"
      font-family="var(--mono)" text-anchor="middle">${sgn(t.pente_sem,3)}</text>
    <!-- consigne -->
    <line x1="${X(v.cible)}" y1="${y-24}" x2="${X(v.cible)}" y2="${y+13}"
      stroke="var(--setpoint)" stroke-width="2"/>
    <path d="M${X(v.cible)-5},${y-24} L${X(v.cible)+5},${y-24} L${X(v.cible)},${y-17} Z"
      fill="var(--setpoint)"/>
    <text x="${X(v.cible)}" y="${y-29}" fill="var(--setpoint)" font-size="9"
      font-family="var(--cond)" text-anchor="middle" letter-spacing="1">CONSIGNE</text>
  </svg>`;
}

/* ---------- Courbe de poids ---------- */
function courbe(p, t){
  const W=340, H=150, L=34, R=10, T=12, B=22;
  const ds = p.dates.map(s=>new Date(s+"T12:00:00").getTime());
  const all = p.brut.concat(p.lisse);
  let lo = Math.min(...all), hi = Math.max(...all);
  const m = (hi-lo)*0.15 || 0.5; lo-=m; hi+=m;
  const x0=ds[0], x1=ds[ds.length-1];
  const X = v => L + (v-x0)/(x1-x0||1)*(W-L-R);
  const Y = v => T + (hi-v)/(hi-lo)*(H-T-B);
  const pts = a => a.map((v,i)=>`${X(ds[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const gy = [];
  for(let i=0;i<=3;i++){ const v = lo+(hi-lo)*i/3;
    gy.push(`<line x1="${L}" y1="${Y(v)}" x2="${W-R}" y2="${Y(v)}" stroke="var(--panel-3)"/>
      <text x="${L-5}" y="${Y(v)+3}" fill="var(--dimmer)" font-size="9"
        font-family="var(--mono)" text-anchor="end">${v.toFixed(1)}</text>`); }
  const fit = t.fit;
  const fx0 = X(new Date(fit.x0+"T12:00:00").getTime());
  const fx1 = X(new Date(fit.x1+"T12:00:00").getTime());
  return `<svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Poids brut, moyenne 7 jours et droite de tendance">
    ${gy.join("")}
    <polyline points="${pts(p.brut)}" fill="none" stroke="var(--dimmer)"
      stroke-width="1" opacity=".55"/>
    ${p.brut.map((v,i)=>`<circle cx="${X(ds[i])}" cy="${Y(v)}" r="1.6"
      fill="var(--dimmer)"/>`).join("")}
    <polyline points="${pts(p.lisse)}" fill="none" stroke="var(--measure)"
      stroke-width="2"/>
    <line x1="${fx0}" y1="${Y(fit.y0)}" x2="${fx1}" y2="${Y(fit.y1)}"
      stroke="var(--setpoint)" stroke-width="1.5" stroke-dasharray="4 3"/>
  </svg>
  <div style="display:flex;gap:14px;margin-top:6px;font-size:10px;color:var(--dimmer)">
    <span><b style="color:var(--dimmer)">•</b> pesees</span>
    <span><b style="color:var(--measure)">—</b> moyenne 7j</span>
    <span><b style="color:var(--setpoint)">--</b> tendance (sur le brut)</span>
  </div>`;
}

/* ---------- Composantes ---------- */
function barres(c){
  const parts = [["bmr","Metabolisme de base","#4C5B6E"],["tef","Digestion","#7D6A55"],
    ["pas","Pas","#39C5CF"],["seance","Seances","#D29922"],["cardio","Cardio","#A371F7"]];
  const tot = parts.reduce((s,[k])=>s+(c[k]||0),0) || 1;
  let x = 0;
  const seg = parts.map(([k,l,col])=>{
    const w = (c[k]||0)/tot*340; const r = `<rect x="${x}" y="0" width="${w}"
      height="20" fill="${col}"/>`; x += w; return r; }).join("");
  return `<svg viewBox="0 0 340 20" style="border-radius:2px">${seg}</svg>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:11px">
      ${parts.filter(([k])=>c[k]>1).map(([k,l,col])=>
        `<span style="color:var(--dim)"><b style="color:${col}">■</b> ${l}
         <span class="num" style="color:var(--text)">${Math.round(c[k])}</span></span>`).join("")}
    </div>`;
}

/* ---------- Vue Analyse ---------- */
async function vueAnalyse(){
  const el = $("v-analyse");
  el.innerHTML = `<div class="center"><span class="spin"></span>
    <div style="margin-top:12px">Demarrage du moteur Python…</div>
    <div style="font-size:12px;color:var(--dimmer);margin-top:6px">
      Premier lancement uniquement. Ensuite il reste en cache.</div></div>`;
  let a;
  try{ a = await analyse(); }
  catch(e){ el.innerHTML = `<div class="note alarm"><b>Moteur indisponible.</b><br>
    ${esc(e.message||e)}<br><br>Verifie ta connexion au premier lancement :
    Pyodide se telecharge une seule fois, ensuite tout marche hors-ligne.</div>`;
    return; }

  if(a.erreur){ el.innerHTML = `<div class="center">${esc(a.erreur)}</div>`; return; }

  const t = a.tendance, v = a.verdict;
  const cls = v.etat === "nominal" ? "v-nominal" : "v-alarm";
  const mot = v.etat === "nominal" ? "Tenir" : "Ajuster";

  let h = `<div class="panel">
    <div class="panel-h"><span class="led led-${v.etat==="nominal"?"nominal":"alarm"}"></span>
      <span class="panel-t">Verdict — vitesse de prise</span></div>
    <div class="gauge">
      <div class="gauge-top"><span class="verdict-w ${cls}">${mot}</span>
        <span class="unit">${sgn(t.pct_sem,2)} %/sem</span></div>
      ${jauge(t, v)}
      <div class="gauge-msg">${esc(v.message)}
        ${v.semaines_requises !== null && v.semaines_requises !== undefined ?
          `<br><br>Il faut environ <b>${v.semaines_requises} semaine(s)</b>
           de plus pour que la bande se resserre assez et permette de trancher.` : ""}
      </div>
    </div>
  </div>`;

  if(a.alerte_eau){
    h += `<div class="note"><b>Variation recente de ${sgn(a.alerte_eau.delta)} kg.</b>
      A ton apport, ca demanderait ${Math.round(a.alerte_eau.kcal)} kcal de balance :
      impossible en tissu. C'est de l'eau, du glycogene ou du contenu digestif.
      La pente ci-dessus est contaminee par ce saut.</div>`;
  }

  h += `<div class="panel"><div class="panel-h"><span class="panel-t">Poids</span>
    <span class="hdr-r">${t.n} pesees / 28 j</span></div><div class="panel-b">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px">
      <span class="big">${f(t.actuel,2)}</span><span class="unit">kg · moy 7j</span></div>
    ${courbe(a.poids, t)}
    <div class="kv" style="margin-top:12px"><span class="k">Pente</span>
      <span class="v">${sgn(t.pente_sem,3)} kg/sem
        <span class="ic">[${sgn(t.bas,3)} ; ${sgn(t.haut,3)}]</span></span></div>
    <div class="kv"><span class="k">Bruit residuel σ</span>
      <span class="v">${f(t.sigma,2)} kg</span></div>
    <div class="kv"><span class="k">R²</span><span class="v">${f(t.r2,3)}</span></div>
  </div></div>`;

  if(a.tdee){
    const d = a.tdee;
    h += `<div class="panel"><div class="panel-h"><span class="panel-t">Depense</span></div>
      <div class="panel-b">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span class="big">${Math.round(d.tdee)}</span><span class="unit">kcal/j</span></div>
      <div class="ic" style="margin:4px 0 12px">IC 95 % : ${Math.round(d.bas)} – ${Math.round(d.haut)}
        &nbsp;·&nbsp; ±${Math.round(d.demi_ic)} kcal</div>
      ${a.composantes ? barres(a.composantes) : ""}
      <div class="kv" style="margin-top:12px"><span class="k">Apport moyen</span>
        <span class="v">${Math.round(d.apport_moyen)} kcal/j</span></div>
      <div class="kv"><span class="k">Balance</span>
        <span class="v">${sgn(d.apport_moyen-d.tdee,0)} kcal/j</span></div>`;
    if(a.calib){
      h += `<div class="kv"><span class="k">Calibration k</span>
        <span class="v ${a.calib.plausible?"":"neg"}">${f(a.calib.k,3)}</span></div>`;
      if(!a.calib.plausible) h += `<div class="note alarm">${esc(a.calib.message)}</div>`;
    }
    if(a.cibles){
      h += `<table style="margin-top:12px"><thead><tr><th>Vitesse</th>
        <th>kg/sem</th><th>Apport</th></tr></thead><tbody>`;
      a.cibles.forEach(c=>{ h += `<tr><td class="name">+${c.pct.toFixed(2)} %/sem</td>
        <td>${sgn(c.kg_sem)}</td><td><b>${Math.round(c.kcal)}</b></td></tr>`; });
      h += `</tbody></table>`;
    }
    h += `</div></div>`;
  }
  el.innerHTML = h;
}

/* ---------- Vue Perfs ---------- */
async function vuePerfs(){
  const el = $("v-perfs");
  el.innerHTML = `<div class="center"><span class="spin"></span>
    <div style="margin-top:12px">Analyse des seances…</div></div>`;
  let a;
  try{ a = await analyse(); }
  catch(e){ el.innerHTML = `<div class="note alarm">${esc(e.message||e)}</div>`; return; }
  if(!a.tendances || !a.tendances.length){
    el.innerHTML = `<div class="center">Aucune seance. Importe ton JSON
      depuis l'onglet Saisie.</div>`; return;
  }

  let h = "";
  if(a.indice_force){
    const ks = Object.keys(a.indice_force).sort((x,y)=>x-y);
    const vs = ks.map(k=>a.indice_force[k]);
    const lo = Math.min(...vs)-1, hi = Math.max(...vs)+1;
    const W=340,H=90,L=30,R=10,T=10,B=18;
    const X = i => L + i/(ks.length-1||1)*(W-L-R);
    const Y = v => T + (hi-v)/(hi-lo)*(H-T-B);
    h += `<div class="panel"><div class="panel-h"><span class="panel-t">Indice de force</span>
      <span class="hdr-r">base 100 · S${ks[0]}</span></div><div class="panel-b">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
        <span class="big">${f(vs[vs.length-1],1)}</span>
        <span class="unit">${sgn(vs[vs.length-1]-100,1)} % depuis S${ks[0]}</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Indice de force par semaine">
        <polyline points="${vs.map((v,i)=>X(i)+","+Y(v)).join(" ")}" fill="none"
          stroke="var(--nominal)" stroke-width="2"/>
        ${vs.map((v,i)=>`<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="var(--nominal)"/>
          <text x="${X(i)}" y="${H-5}" fill="var(--dimmer)" font-size="9"
            font-family="var(--mono)" text-anchor="middle">S${ks[i]}</text>`).join("")}
      </svg>
      <p style="font-size:12px;color:var(--dim);margin:8px 0 0;line-height:1.5">
        Chaque exercice est normalise par sa propre base avant moyenne. Les series
        marquees par une rupture de reference sont exclues.</p>
      </div></div>`;
  }

  if(a.ruptures && a.ruptures.length){
    h += `<div class="panel"><div class="panel-h">
      <span class="led led-warn"></span><span class="panel-t">Ruptures de reference</span>
      <span class="hdr-r">${a.ruptures.length}</span></div><div class="panel-b">`;
    a.ruptures.forEach(r=>{
      h += `<div style="padding:7px 0;border-bottom:1px solid var(--panel-3)">
        <div style="font-size:12.5px">${esc(r.exercice)}
          <span style="color:var(--dimmer)">· ${esc(r.seance)} · S${r.semaine}</span></div>
        <div class="num" style="font-size:12px;color:var(--warn);margin-top:2px">
          ${f(r.avant)} → ${f(r.apres)} kg (−${Math.round(r.baisse)} %)</div>
        ${r.notes && r.notes.length ? `<div style="font-size:11.5px;color:var(--dim);
          margin-top:2px;font-style:italic">« ${esc(r.notes[0])} »</div>`:""}
      </div>`; });
    h += `<div class="note">Une chute de charge de cette ampleur en une semaine,
      en surplus calorique, n'est pas une perte de force. C'est une execution
      corrigee, une machine differente ou une tentative ratee. Les compter ferait
      dire aux donnees l'inverse de la realite.</div></div></div>`;
  }

  h += `<div class="panel"><div class="panel-h"><span class="panel-t">Tendances</span>
    <span class="hdr-r">${a.tendances.length} series</span></div>
    <div class="panel-b" style="padding:6px 8px">
    <table><thead><tr><th>Exercice</th><th>n</th><th>Δ%</th><th>%/sem</th></tr></thead><tbody>`;
  a.tendances.forEach(t=>{
    const c = t.pct_sem > 0.5 ? "pos" : t.pct_sem < 0 ? "neg" : "neu";
    h += `<tr><td class="name">${esc(t.exercice)}
      <span style="color:var(--dimmer);font-size:10px">${esc(t.seance)}${
        t.fiabilite==="indicative" ? " · e1RM indicatif" : ""}</span></td>
      <td>${t.n}</td><td>${sgn(t.delta_pct,1)}</td>
      <td class="${c}">${sgn(t.pct_sem,2)}</td></tr>`; });
  h += `</tbody></table></div></div>`;

  if(a.correlation){
    const c = a.correlation;
    const nok = c.verdict !== "significatif";
    h += `<div class="panel"><div class="panel-h">
      <span class="led led-${nok?"off":"nominal"}"></span>
      <span class="panel-t">Force vs masse</span></div><div class="panel-b">
      <div class="kv"><span class="k">Semaines</span><span class="v">${c.n}</span></div>
      <div class="kv"><span class="k">r observe</span><span class="v">${sgn(c.r,3)}</span></div>
      <div class="kv"><span class="k">|r| requis (p&lt;0.05)</span>
        <span class="v">${f(c.r_requis,2)}</span></div>
      <div class="note ${nok?"":"info"}" style="white-space:pre-wrap">${esc(c.diagnostic)}</div>
      </div></div>`;
  }
  el.innerHTML = h;
}

/* ---------- Navigation ---------- */
const VUES = {saisie:null, analyse:vueAnalyse, perfs:vuePerfs};
function nav(v){
  Object.keys(VUES).forEach(k=>{
    $("v-"+k).classList.toggle("hide", k !== v);
    $("n-"+k).setAttribute("aria-selected", k === v);
  });
  if(VUES[v]) VUES[v]();
  $("hdr-stat").textContent = v === "saisie" ? jour : "moteur python";
}

/* ---------- Import / export ---------- */
function exporter(){
  const nom = "suivi_coach_" + new Date().toISOString().slice(0,10) + ".json";
  const b = new Blob([JSON.stringify(DB,null,1)], {type:"application/json"});
  const u = URL.createObjectURL(b);
  const a = document.createElement("a"); a.href = u; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(u), 1000);
  toast("Exporte — enregistre dans Fichiers");
}
function importer(file){
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const d = JSON.parse(r.result);
      const nj = Object.keys(d.entries||{}).length;
      Object.assign(DB.entries, d.entries||{});
      const vus = new Set(DB.seances.map(s=>s.date+"|"+s.seance));
      (d.seances||[]).forEach(s=>{ if(!vus.has(s.date+"|"+s.seance)) DB.seances.push(s); });
      DB.seances.sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:0);
      // On fusionne les reglages sans ecraser ceux deja presents : reimporter
      // ne doit pas remettre k_calib a 1 et perdre la calibration.
      DB.settings = {...(d.settings||{}), ...DB.settings};
      save(); chargeJour(); ANA = null;
      toast(nj + " jours importes");
    }catch(e){ toast("JSON illisible", true); }
  };
  r.readAsText(file);
}

/* ---------- Init ---------- */
load(); stats(); chargeJour();
CHAMPS.forEach(c=>{
  const el = $("f-"+c);
  el.addEventListener(c === "seance" ? "change" : "input", e=>ecrit(c, e.target.value));
});
$("d-jour").addEventListener("change", e=>{ jour = e.target.value; chargeJour(); });
$("b-prev").onclick = ()=>decale(-1);
$("b-next").onclick = ()=>decale(1);
$("b-export").onclick = exporter;
$("b-import").onclick = ()=>$("f-file").click();
$("f-file").onchange = e=>{ if(e.target.files[0]) importer(e.target.files[0]); };
Object.keys(VUES).forEach(k=> $("n-"+k).onclick = ()=>nav(k));
nav("saisie");

if("serviceWorker" in navigator){
  addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
