// ============================================
// KubeOps Pro — app.js
// Full Kubernetes Dashboard — Real + Simulated
// ============================================

// ---- SERVER CONNECTION ----
// When server.js is running, API calls go to the real cluster.
// When opening index.html directly, all data is simulated.
const API_BASE = 'http://localhost:3001';
let serverOnline = false;

async function detectServer() {
  try {
    const r = await fetch(`${API_BASE}/api/context`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const d = await r.json();
      serverOnline = true;
      showServerBanner(d.context, d.server);
      loadRealData();
    }
  } catch {
    serverOnline = false;
    showSimBanner();
  }
}

function showServerBanner(ctx, server) {
  let b = document.getElementById('mode-banner');
  if (!b) { b = document.createElement('div'); b.id = 'mode-banner'; document.querySelector('.topbar-left').prepend(b); }
  b.innerHTML = `<span style="font-size:10px;background:rgba(52,211,153,.15);color:var(--green);border:1px solid rgba(52,211,153,.3);border-radius:4px;padding:2px 8px;font-family:var(--font-mono)">⬤ LIVE · ${ctx}</span>`;
}

function showSimBanner() {
  let b = document.getElementById('mode-banner');
  if (!b) { b = document.createElement('div'); b.id = 'mode-banner'; document.querySelector('.topbar-left').prepend(b); }
  b.innerHTML = `<span style="font-size:10px;background:rgba(251,191,36,.1);color:var(--amber);border:1px solid rgba(251,191,36,.25);border-radius:4px;padding:2px 8px;font-family:var(--font-mono)" title="Run node server.js to connect to a real cluster">⬤ SIMULATED</span>`;
}

async function loadRealData() {
  if (!serverOnline) return;
  try {
    const ns = currentNS;
    const [podsR, depsR, svcsR, evtsR] = await Promise.all([
      fetch(`${API_BASE}/api/pods?namespace=${ns}`).then(r=>r.json()),
      fetch(`${API_BASE}/api/deployments?namespace=${ns}`).then(r=>r.json()),
      fetch(`${API_BASE}/api/services?namespace=${ns}`).then(r=>r.json()),
      fetch(`${API_BASE}/api/events?namespace=${ns}`).then(r=>r.json()),
    ]);
    if (podsR.pods)        pods        = podsR.pods.map(p => ({...p, cpu: Math.floor(Math.random()*60+5), mem: Math.floor(Math.random()*60+10)}));
    if (depsR.deployments) deployments = depsR.deployments.map(d => ({...d, cpuReq:'100m', memLim:'512Mi'}));
    if (svcsR.services)    services    = svcsR.services;
    if (evtsR.events)      events      = evtsR.events;
    renderAll(); updateKPIs(); initRing(); renderDashEvents();
    toast('✓ Loaded live cluster data');
  } catch (e) {
    console.warn('Failed to load real data:', e);
  }
}

// ---- STATE ----
let pods = [], deployments = [], services = [], events = [], statefulsets = [], jobs = [], cronjobs = [];
let currentNS = 'default';
let resourceHistory = { cpu: [], mem: [] };
let chartAnimFrame = null;
const MAX_HISTORY = 30;