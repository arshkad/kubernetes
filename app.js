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

// ---- INIT DATA ----
function initData() {
  pods = [
    { name:'api-server-6d8bf9-xk2pq', ns:'default', status:'Running', restarts:0, cpu:45, mem:62, node:'node-1', age:'3d', image:'gcr.io/proj/api:v2.4.1', ready:'1/1' },
    { name:'api-server-6d8bf9-m9rvt',  ns:'default', status:'Running', restarts:1, cpu:38, mem:58, node:'node-2', age:'3d', image:'gcr.io/proj/api:v2.4.1', ready:'1/1' },
    { name:'frontend-7c9df-jlp2x',      ns:'default', status:'Running', restarts:0, cpu:12, mem:31, node:'node-1', age:'5d', image:'gcr.io/proj/frontend:v1.9.0', ready:'1/1' },
    { name:'frontend-7c9df-nqr8w',      ns:'default', status:'Running', restarts:0, cpu:9,  mem:28, node:'node-3', age:'5d', image:'gcr.io/proj/frontend:v1.9.0', ready:'1/1' },
    { name:'redis-primary-0',            ns:'default', status:'Running', restarts:0, cpu:22, mem:48, node:'node-2', age:'12d', image:'redis:7.2-alpine', ready:'1/1' },
    { name:'postgres-0',                 ns:'default', status:'Running', restarts:0, cpu:35, mem:71, node:'node-3', age:'15d', image:'postgres:15.4', ready:'1/1' },
    { name:'worker-6f7c4-dn3kx',        ns:'default', status:'Pending', restarts:0, cpu:0,  mem:0,  node:'<none>', age:'2m', image:'gcr.io/proj/worker:v1.2.3', ready:'0/1' },
    { name:'cronjob-sync-28450160',      ns:'default', status:'Failed',  restarts:3, cpu:0,  mem:0,  node:'node-1', age:'47m', image:'gcr.io/proj/sync:v1.0', ready:'0/1' },
  ];

  deployments = [
    { name:'api-server',    image:'gcr.io/proj/api:v2.4.1',          replicas:2, available:2, strategy:'RollingUpdate', cpuReq:'100m', memLim:'512Mi', age:'3d' },
    { name:'frontend',      image:'gcr.io/proj/frontend:v1.9.0',      replicas:2, available:2, strategy:'RollingUpdate', cpuReq:'50m',  memLim:'256Mi', age:'5d' },
    { name:'worker',        image:'gcr.io/proj/worker:v1.2.3',        replicas:1, available:0, strategy:'RollingUpdate', cpuReq:'200m', memLim:'1Gi',   age:'1d' },
    { name:'redis-exporter',image:'oliver006/redis_exporter:v1.55',   replicas:1, available:1, strategy:'Recreate',     cpuReq:'25m',  memLim:'64Mi',  age:'8d' },
  ];

  services = [
    { name:'api-server', type:'ClusterIP',    clusterIP:'10.96.45.12', externalIP:'<none>',      ports:'8080/TCP',       selector:'app=api-server', age:'3d' },
    { name:'frontend',   type:'LoadBalancer', clusterIP:'10.96.71.88', externalIP:'34.122.45.6', ports:'80:32100/TCP',   selector:'app=frontend',   age:'5d' },
    { name:'redis',      type:'ClusterIP',    clusterIP:'10.96.12.3',  externalIP:'<none>',      ports:'6379/TCP',       selector:'app=redis',      age:'12d' },
    { name:'postgres',   type:'ClusterIP',    clusterIP:'10.96.55.9',  externalIP:'<none>',      ports:'5432/TCP',       selector:'app=postgres',   age:'15d' },
    { name:'kubernetes', type:'ClusterIP',    clusterIP:'10.96.0.1',   externalIP:'<none>',      ports:'443/TCP',        selector:'<none>',         age:'30d' },
  ];
  statefulsets = [
    { name:'redis-primary',  replicas:1, ready:1, storageClass:'standard-ssd', pvcTemplate:'redis-data-10Gi',    age:'12d' },
    { name:'postgres',       replicas:1, ready:1, storageClass:'standard-ssd', pvcTemplate:'postgres-data-100Gi', age:'15d' },
  ];

  jobs = [
    { name:'db-migration-v8',   status:'Complete', completions:'1/1', duration:'42s',  age:'2d' },
    { name:'data-export-jan',   status:'Complete', completions:'1/1', duration:'5m12s', age:'5d' },
    { name:'cronjob-sync-28450160', status:'Failed', completions:'0/1', duration:'—',  age:'47m' },
  ];

  cronjobs = [
    { name:'db-backup',    schedule:'0 2 * * *',    lastRun:'2h ago',  lastStatus:'Complete', active:0 },
    { name:'log-rotate',   schedule:'0 0 * * 0',    lastRun:'3d ago',  lastStatus:'Complete', active:0 },
    { name:'sync-assets',  schedule:'*/30 * * * *', lastRun:'17m ago', lastStatus:'Failed',   active:1 },
  ];

  events = [
    { time:'0s',  type:'Normal',  obj:'Pod/worker-6f7c4-dn3kx',          reason:'Scheduled',          msg:'Successfully assigned to node-2',           count:1  },
    { time:'47m', type:'Warning', obj:'Pod/cronjob-sync-28450160',        reason:'BackOff',             msg:'Back-off restarting failed container sync',  count:5  },
    { time:'1h',  type:'Normal',  obj:'Deployment/api-server',            reason:'ScalingReplicaSet',   msg:'Scaled up replica set to 2',                count:1  },
    { time:'2h',  type:'Warning', obj:'Node/node-3',                      reason:'NodeNotReady',        msg:'Node condition changed to NotReady (recovered)', count:2 },
    { time:'3h',  type:'Normal',  obj:'Pod/frontend-7c9df-jlp2x',        reason:'Pulled',              msg:'Container image pulled in 4.2s',            count:1  },
    { time:'5h',  type:'Normal',  obj:'Service/frontend',                 reason:'UpdatedLoadBalancer', msg:'Updated load balancer with new hosts',      count:1  },
    { time:'6h',  type:'Warning', obj:'Pod/redis-primary-0',              reason:'Liveness',            msg:'Liveness probe slow: 8.3s (threshold 5s)',  count:3  },
    { time:'8h',  type:'Normal',  obj:'Deployment/worker',                reason:'DeploymentRollout',   msg:'Rolling update started',                   count:1  },
    { time:'10h', type:'Normal',  obj:'PersistentVolumeClaim/postgres-data', reason:'Provisioning',    msg:'Volume successfully provisioned',           count:1  },
    { time:'12h', type:'Warning', obj:'Pod/postgres-0',                   reason:'OOMKilled',           msg:'Container exceeded memory limit, restarted',count:1  },
    { time:'1d',  type:'Normal',  obj:'Namespace/default',                reason:'Created',             msg:'Namespace created by cluster-admin',        count:1  },
    { time:'30d', type:'Normal',  obj:'Node/node-1',                      reason:'RegisteredNode',      msg:'Node joined cluster successfully',          count:1  },
  ];

  renderAll();
  initChart();
  initRing();
  renderNodeCards();
  renderDashEvents();
  renderNodeMini();
  updateYamlPreview();
  initTerminal();
}

// ---- RENDER ALL ----
function renderAll() {
  renderPods();
  renderDeployments();
  renderServices();
  renderStatefulSets();
  renderJobs();
  renderCronJobs();
  renderEvents();
  updateKPIs();
}

function updateKPIs() {
  document.getElementById('kpi-pods').textContent = pods.length;
  document.getElementById('kpi-deps').textContent = deployments.length;
  document.getElementById('nb-pods').textContent = pods.length;
  document.getElementById('nb-deps').textContent = deployments.length;
  document.getElementById('nb-svcs').textContent = services.length;
  document.getElementById('nb-sts').textContent = statefulsets.length;
  document.getElementById('nb-events').textContent = events.filter(e => e.type === 'Warning').length;
  const failedJobs = jobs.filter(j => j.status === 'Failed').length + cronjobs.filter(c => c.lastStatus === 'Failed').length;
  document.getElementById('nb-jobs').textContent = jobs.length + cronjobs.length;
  document.getElementById('nb-nodes').textContent = 3;
}

// ---- PODS ----
function renderPods() {
  const filter = document.getElementById('pod-status-filter')?.value || 'all';
  const tbody = document.getElementById('pods-tbody');
  if (!tbody) return;
  const filtered = pods.filter(p => filter === 'all' || p.status === filter);
  tbody.innerHTML = filtered.map((p, i) => {
    const cpuClass = p.cpu > 80 ? 'p-red' : p.cpu > 60 ? 'p-amber' : 'p-cyan';
    const memClass = p.mem > 80 ? 'p-red' : p.mem > 60 ? 'p-amber' : 'p-green';
    const statusBadge = {Running:'running', Pending:'pending', Failed:'failed', Terminating:'terminating'}[p.status] || 'pending';
    return `<tr>
      <td style="width:20px;padding-right:0">
        <div style="width:6px;height:6px;border-radius:50%;background:${p.status==='Running'?'var(--green)':p.status==='Pending'?'var(--amber)':'var(--red)'}"></div>
      </td>
      <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.name}">${p.name}</td>
      <td class="muted mono">${p.ns}</td>
      <td><span class="badge ${statusBadge}">${p.status}</span></td>
      <td style="color:${p.restarts>0?'var(--amber)':'var(--text3)'};" class="mono">${p.restarts}</td>
      <td>${p.status==='Running'?`<div class="prog-wrap"><div class="prog"><div class="prog-fill ${cpuClass}" style="width:${p.cpu}%"></div></div><span class="prog-text">${p.cpu}%</span></div>`:'<span class="muted">—</span>'}</td>
      <td>${p.status==='Running'?`<div class="prog-wrap"><div class="prog"><div class="prog-fill ${memClass}" style="width:${p.mem}%"></div></div><span class="prog-text">${p.mem}%</span></div>`:'<span class="muted">—</span>'}</td>
      <td class="mono muted">${p.node}</td>
      <td class="muted">${p.age}</td>
      <td><div class="action-btns">
        <button class="tiny-btn" onclick="showPodModal(${pods.indexOf(p)})">Logs</button>
        <button class="tiny-btn" onclick="deletePod(${pods.indexOf(p)})">✕</button>
      </div></td>
    </tr>`;
  }).join('');
}

// ---- DEPLOYMENTS ----
function renderDeployments() {
  const tbody = document.getElementById('deps-tbody');
  if (!tbody) return;
  tbody.innerHTML = deployments.map((d, i) => {
    const ok = d.available === d.replicas;
    return `<tr>
      <td class="mono">${d.name}</td>
      <td class="mono muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.image}">${d.image}</td>
      <td class="mono">${d.replicas}</td>
      <td><span style="color:${ok?'var(--green)':'var(--amber)'}" class="mono">${d.available}/${d.replicas}</span></td>
      <td class="muted">${d.strategy}</td>
      <td class="mono muted">${d.cpuReq}</td>
      <td class="mono muted">${d.memLim}</td>
      <td class="muted">${d.age}</td>
      <td><div class="scale-ctrl">
        <button class="sc-btn" onclick="scaleDep(${i},-1)">−</button>
        <span class="sc-num" id="sc-${i}">${d.replicas}</span>
        <button class="sc-btn" onclick="scaleDep(${i},1)">+</button>
      </div></td>
      <td><div class="action-btns">
        <button class="tiny-btn" onclick="rollout(${i})">↺ Rollout</button>
        <button class="tiny-btn" onclick="deleteDep(${i})">✕</button>
      </div></td>
    </tr>`;
  }).join('');
}
// ---- SERVICES ----
function renderServices() {
  const tbody = document.getElementById('svcs-tbody');
  if (!tbody) return;
  tbody.innerHTML = services.map(s => {
    const typeCls = {LoadBalancer:'running', NodePort:'pending', ClusterIP:'completed'}[s.type] || 'completed';
    return `<tr>
      <td class="mono">${s.name}</td>
      <td><span class="badge ${typeCls}">${s.type}</span></td>
      <td class="mono muted">${s.clusterIP}</td>
      <td class="mono" style="color:${s.externalIP!=='<none>'?'var(--teal)':'var(--text3)'}">${s.externalIP}</td>
      <td class="mono muted">${s.ports}</td>
      <td class="mono muted">${s.selector}</td>
      <td class="muted">${s.age}</td>
    </tr>`;
  }).join('');
}
// ---- STATEFULSETS ----
function renderStatefulSets() {
  const tbody = document.getElementById('sts-tbody');
  if (!tbody) return;
  tbody.innerHTML = statefulsets.map(s => `<tr>
    <td class="mono">${s.name}</td>
    <td class="mono">${s.replicas}</td>
    <td style="color:${s.ready===s.replicas?'var(--green)':'var(--amber)'}" class="mono">${s.ready}/${s.replicas}</td>
    <td class="muted">${s.storageClass}</td>
    <td class="mono muted">${s.pvcTemplate}</td>
    <td class="muted">${s.age}</td>
  </tr>`).join('');
}

// ---- JOBS ----
function renderJobs() {
  const tbody = document.getElementById('jobs-tbody');
  if (!tbody) return;
  tbody.innerHTML = jobs.map(j => {
    const cls = j.status === 'Complete' ? 'completed' : 'failed';
    return `<tr>
      <td class="mono">${j.name}</td>
      <td><span class="badge ${cls}">${j.status}</span></td>
      <td class="mono muted">${j.completions}</td>
      <td class="mono muted">${j.duration}</td>
      <td class="muted">${j.age}</td>
    </tr>`;
  }).join('');
}

function renderCronJobs() {
  const tbody = document.getElementById('cronjobs-tbody');
  if (!tbody) return;
  tbody.innerHTML = cronjobs.map((c, i) => {
    const cls = c.lastStatus === 'Complete' ? 'completed' : 'failed';
    return `<tr>
      <td class="mono">${c.name}</td>
      <td class="mono" style="color:var(--purple)">${c.schedule}</td>
      <td class="muted">${c.lastRun}</td>
      <td><span class="badge ${cls}">${c.lastStatus}</span></td>
      <td class="mono">${c.active}</td>
      <td><button class="tiny-btn" onclick="triggerCronJob(${i})">▶ Run Now</button></td>
    </tr>`;
  }).join('');
}

// ---- EVENTS ----
function renderEvents(typeFilter) {
  const tbody = document.getElementById('events-tbody');
  if (!tbody) return;
  const filtered = typeFilter && typeFilter !== 'all' ? events.filter(e => e.type === typeFilter) : events;
  tbody.innerHTML = filtered.map(e => `<tr>
    <td class="muted mono" style="white-space:nowrap">${e.time}</td>
    <td><span class="badge ${e.type==='Warning'?'warn-type':'completed'}">${e.type}</span></td>
    <td class="mono muted" style="white-space:nowrap;font-size:10px">${e.obj}</td>
    <td style="color:var(--blue);font-size:11px">${e.reason}</td>
    <td class="mono muted">${e.count}</td>
    <td style="font-size:11px;color:var(--text2)">${e.msg}</td>
  </tr>`).join('');
}

function filterEvents(val) { renderEvents(val); }

// ---- NODE CARDS ----
const nodeData = [
  { name:'node-1', role:'worker', status:'Ready', cpu:58, mem:71, pods:3, capacity:'4 vCPU · 8 GiB', version:'1.28.4', zone:'us-central1-a' },
  { name:'node-2', role:'worker', status:'Ready', cpu:35, mem:44, pods:2, capacity:'4 vCPU · 8 GiB', version:'1.28.4', zone:'us-central1-b' },
  { name:'node-3', role:'worker', status:'Ready', cpu:42, mem:69, pods:2, capacity:'4 vCPU · 16 GiB', version:'1.28.3', zone:'us-central1-c' },
];

function renderNodeCards() {
  const el = document.getElementById('node-cards');
  if (!el) return;
  el.innerHTML = nodeData.map(n => {
    const cpuCls = n.cpu > 80 ? '#f87171' : n.cpu > 60 ? '#fbbf24' : '#00d4ff';
    const memCls = n.mem > 80 ? '#f87171' : n.mem > 60 ? '#fbbf24' : '#a78bfa';
    return `<div class="node-card-big">
      <div class="nc-header">
        <div>
          <div class="nc-name">${n.name}</div>
          <div class="nc-role">${n.role} · ${n.zone}</div>
        </div>
        <span class="badge success">Ready</span>
      </div>
      <div class="nc-resource">
        <div class="nc-res-label"><span>CPU</span><span>${n.cpu}%</span></div>
        <div class="nc-bar"><div class="nc-bar-fill" style="width:${n.cpu}%;background:${cpuCls}"></div></div>
      </div>
      <div class="nc-resource" style="margin-top:8px">
        <div class="nc-res-label"><span>Memory</span><span>${n.mem}%</span></div>
        <div class="nc-bar"><div class="nc-bar-fill" style="width:${n.mem}%;background:${memCls}"></div></div>
      </div>
      <div class="nc-meta">
        <div class="nc-meta-item"><div class="nc-meta-label">Capacity</div><div class="nc-meta-val" style="font-size:10px">${n.capacity}</div></div>
        <div class="nc-meta-item"><div class="nc-meta-label">Pods</div><div class="nc-meta-val">${n.pods} running</div></div>
        <div class="nc-meta-item"><div class="nc-meta-label">k8s Version</div><div class="nc-meta-val">${n.version}</div></div>
        <div class="nc-meta-item"><div class="nc-meta-label">Runtime</div><div class="nc-meta-val">containerd</div></div>
      </div>
    </div>`;
  }).join('');
}

function renderNodeMini() {
  const el = document.getElementById('node-mini');
  if (!el) return;
  el.innerHTML = nodeData.map(n => {
    const cpuCls = n.cpu > 80 ? 'var(--red)' : n.cpu > 60 ? 'var(--amber)' : 'var(--cyan)';
    const memCls = n.mem > 80 ? 'var(--red)' : n.mem > 60 ? 'var(--amber)' : 'var(--purple)';
    return `<div class="node-mini-item">
      <div class="node-mini-header">
        <span class="node-mini-name">${n.name}</span>
        <span class="muted" style="font-size:10px">${n.pods} pods</span>
      </div>
      <div class="bar-wrap"><div class="bar-inner" style="width:${n.cpu}%;background:${cpuCls}"></div></div>
      <div class="bar-wrap" style="margin-top:3px"><div class="bar-inner" style="width:${n.mem}%;background:${memCls}"></div></div>
    </div>`;
  }).join('');
}

function renderDashEvents() {
  const el = document.getElementById('dash-events');
  if (!el) return;
  const recent = events.slice(0, 6);
  el.innerHTML = recent.map(e => `
    <div class="dash-event">
      <div class="de-type"><span class="badge ${e.type==='Warning'?'warn-type':'completed'}" style="font-size:9px">${e.type}</span></div>
      <div>
        <div class="de-obj">${e.obj}</div>
        <div class="de-msg">${e.msg}</div>
      </div>
      <div class="de-time">${e.time}</div>
    </div>
  `).join('');
}

// ---- CHART ----
function initChart() {
  const canvas = document.getElementById('resource-chart');
  if (!canvas) return;
  for (let i = 0; i < MAX_HISTORY; i++) {
    resourceHistory.cpu.push(Math.round(35 + Math.random() * 25));
    resourceHistory.mem.push(Math.round(45 + Math.random() * 20));
  }
  drawChart();
}

function drawChart() {
  const canvas = document.getElementById('resource-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = rect.width - 32;
  const H = 120;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (H - 20) * (i / 4) + 10;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  function drawLine(data, color) {
    const step = W / (MAX_HISTORY - 1);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    data.forEach((v, i) => {
      const x = i * step;
      const y = H - 10 - ((v / 100) * (H - 20));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawLine(resourceHistory.cpu, '#00d4ff');
  drawLine(resourceHistory.mem, '#a78bfa');

  // Current values
  ctx.fillStyle = 'rgba(0,212,255,0.9)';
  ctx.font = '10px JetBrains Mono, monospace';
  const lastCPU = resourceHistory.cpu[resourceHistory.cpu.length - 1];
  const lastMem = resourceHistory.mem[resourceHistory.mem.length - 1];
  ctx.fillText(`CPU ${lastCPU}%`, W - 90, 18);
  ctx.fillStyle = 'rgba(167,139,250,0.9)';
  ctx.fillText(`MEM ${lastMem}%`, W - 44, 18);
}

// ---- RING CHART ----
function initRing() {
  const canvas = document.getElementById('pod-ring');
  if (!canvas) return;
  const running = pods.filter(p => p.status === 'Running').length;
  const pending = pods.filter(p => p.status === 'Pending').length;
  const failed = pods.filter(p => p.status === 'Failed').length;
  const total = pods.length;

  document.getElementById('ring-center').innerHTML = `${total}<br><small>pods</small>`;

  const data = [
    { label: 'Running', count: running, color: '#34d399' },
    { label: 'Pending', count: pending, color: '#fbbf24' },
    { label: 'Failed',  count: failed,  color: '#f87171' },
  ];

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 130 * dpr; canvas.height = 130 * dpr;
  canvas.style.width = '130px'; canvas.style.height = '130px';
  ctx.scale(dpr, dpr);

  let startAngle = -Math.PI / 2;
  const cx = 65, cy = 65, r = 52, rw = 10;
  ctx.clearRect(0, 0, 130, 130);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = rw;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  data.forEach(d => {
    if (d.count === 0) return;
    const angle = (d.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + angle);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = rw;
    ctx.stroke();
    startAngle += angle;
  });

  const legend = document.getElementById('ring-legend');
  legend.innerHTML = data.map(d => `
    <div class="rl-item">
      <div class="rl-dot" style="background:${d.color}"></div>
      <span>${d.label}</span>
      <span class="rl-count">${d.count}</span>
    </div>
  `).join('');
}

// ---- NAVIGATION ----
const breadcrumbs = {
  dashboard: 'Dashboard',
  pods: 'Workloads / Pods',
  deployments: 'Workloads / Deployments',
  statefulsets: 'Workloads / StatefulSets',
  jobs: 'Workloads / Jobs & CronJobs',
  services: 'Network / Services',
  ingress: 'Network / Ingress',
  volumes: 'Storage / Volumes & PVCs',
  secrets: 'Config / Secrets & ConfigMaps',
  nodes: 'Cluster / Nodes',
  rbac: 'Cluster / RBAC',
  events: 'Cluster / Events',
  terminal: 'Terminal',
  'deploy-wizard': 'Deploy Workload',
};

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const nav = document.querySelector(`[data-view="${name}"]`);
  if (nav) nav.classList.add('active');
  document.getElementById('breadcrumb').textContent = breadcrumbs[name] || name;
  if (name === 'dashboard') { drawChart(); initRing(); renderNodeMini(); renderDashEvents(); }
  if (name === 'nodes') { renderNodeCards(); }
  if (name === 'deploy-wizard') { updateYamlPreview(); }
}

// ---- ACTIONS ----
function scaleDep(i, delta) {
  deployments[i].replicas = Math.max(0, Math.min(20, deployments[i].replicas + delta));
  const el = document.getElementById('sc-' + i);
  if (el) el.textContent = deployments[i].replicas;
  toast(`⬆ Scaled ${deployments[i].name} → ${deployments[i].replicas} replica(s)`);
}

function rollout(i) {
  toast(`🔄 Rollout restart triggered for ${deployments[i].name}`);
  addEvent('Normal', `Deployment/${deployments[i].name}`, 'RolloutRestart', 'Rollout restart initiated by user');
}

function deleteDep(i) {
  const name = deployments[i].name;
  deployments.splice(i, 1);
  renderDeployments();
  updateKPIs();
  toast(`🗑 Deployment "${name}" deleted`);
}

function deletePod(i) {
  const p = pods[i];
  pods[i] = { ...p, status: 'Terminating' };
  renderPods();
  toast(`⏹ Terminating pod ${p.name}`);
  setTimeout(() => {
    pods.splice(pods.findIndex(x => x.name === p.name), 1);
    renderPods();
    updateKPIs();
    initRing();
    toast(`✓ Pod deleted`);
  }, 1800);
}

function scaleAll() {
  deployments.forEach((d, i) => {
    if (d.replicas < 3) { d.replicas++; }
    const el = document.getElementById('sc-' + i);
    if (el) el.textContent = d.replicas;
  });
  toast('⬆ All deployments scaled up by 1');
}

function rolloutRestart() {
  toast('🔄 Rollout restart triggered for all deployments');
  deployments.forEach(d => addEvent('Normal', `Deployment/${d.name}`, 'RolloutRestart', 'Rollout restart initiated'));
}

function triggerCronJob(i) {
  toast(`▶ CronJob ${cronjobs[i].name} triggered manually`);
  cronjobs[i].lastRun = 'just now';
  cronjobs[i].active = 1;
  renderCronJobs();
  setTimeout(() => {
    cronjobs[i].lastStatus = 'Complete';
    cronjobs[i].active = 0;
    renderCronJobs();
    toast(`✓ CronJob ${cronjobs[i].name} completed`);
  }, 3000);
}

async function applyDeploy() {
  const name     = document.getElementById('w-name').value.trim() || 'my-service';
  const image    = document.getElementById('w-image').value.trim() || 'nginx:latest';
  const replicas = parseInt(document.getElementById('w-replicas').value) || 1;
  const cpuReq   = document.getElementById('w-cpu-req').value.trim() || '100m';
  const memLim   = document.getElementById('w-mem-lim').value.trim() || '512Mi';
  const strategy = document.getElementById('w-strategy').value;
  const yaml     = document.getElementById('yaml-preview')?.textContent || '';

  const btn = document.querySelector('.wizard-form .hdr-btn.accent');
  if (btn) { btn.textContent = '⏳ Applying…'; btn.disabled = true; }

  if (serverOnline && yaml) {
    // ── REAL: POST YAML to cluster via server.js ──────────────
    try {
      toast('🚀 Applying YAML to cluster…');
      const r = await fetch(`${API_BASE}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      });
      const result = await r.json();

      // Show result in a mini output box inside the wizard
      let outEl = document.getElementById('apply-output');
      if (!outEl) {
        outEl = document.createElement('pre');
        outEl.id = 'apply-output';
        outEl.style.cssText = 'background:var(--bg);border:1px solid var(--border2);border-radius:8px;padding:12px;font-family:var(--font-mono);font-size:11px;line-height:1.7;max-height:200px;overflow:auto;margin:0 16px 16px;color:var(--green);white-space:pre-wrap';
        document.querySelector('.wizard-form').appendChild(outEl);
      }
      if (result.success) {
        outEl.style.color = 'var(--green)';
        outEl.textContent = '✓ ' + result.output;
        toast(`✓ "${name}" applied to cluster`);
        // Reload real data after a short delay
        setTimeout(loadRealData, 3000);
      } else {
        outEl.style.color = 'var(--red)';
        outEl.textContent = '✗ ' + result.output;
        toast(`✗ Apply failed — see output`);
      }
    } catch (e) {
      toast(`✗ Server error: ${e.message}`);
    }
  } else {
    // ── SIMULATED fallback ────────────────────────────────────
    deployments.push({ name, image, replicas, available: 0, strategy, cpuReq, memLim, age: '0s' });
    for (let i = 0; i < replicas; i++) {
      pods.push({ name: `${name}-${randStr(5)}-${randStr(5)}`, ns: 'default', status: 'Pending', restarts: 0, cpu: 0, mem: 0, node: '<none>', age: '0s', image, ready: '0/1' });
    }
    addEvent('Normal', `Deployment/${name}`, 'ScalingReplicaSet', `Scaled up to ${replicas} replica(s)`);
    renderAll(); updateKPIs();
    toast(`🚀 [sim] Deployment "${name}" applied — pods scheduling…`);
    setTimeout(() => {
      deployments[deployments.length - 1].available = replicas;
      pods.filter(p => p.status === 'Pending' && p.name.startsWith(name)).forEach(p => {
        p.status = 'Running'; p.cpu = Math.floor(10 + Math.random() * 30);
        p.mem = Math.floor(20 + Math.random() * 40); p.node = `node-${Math.ceil(Math.random() * 3)}`; p.age = '5s'; p.ready = '1/1';
      });
      renderAll(); initRing(); toast(`✓ [sim] "${name}" pods are Running`);
    }, 2800);
  }

  showView('deployments');
  if (btn) { btn.textContent = '🚀 Apply to Cluster'; btn.disabled = false; }
}
// ---- YAML PREVIEW ----
function updateYamlPreview() {
  const name    = document.getElementById('w-name')?.value || 'my-service';
  const image   = document.getElementById('w-image')?.value || 'nginx:1.25-alpine';
  const replicas= document.getElementById('w-replicas')?.value || '2';
  const port    = document.getElementById('w-port')?.value || '80';
  const cpuReq  = document.getElementById('w-cpu-req')?.value || '100m';
  const cpuLim  = document.getElementById('w-cpu-lim')?.value || '500m';
  const memReq  = document.getElementById('w-mem-req')?.value || '128Mi';
  const memLim  = document.getElementById('w-mem-lim')?.value || '512Mi';
  const ns      = document.getElementById('w-ns')?.value || 'default';
  const strategy= document.getElementById('w-strategy')?.value || 'RollingUpdate';
  const health  = document.getElementById('w-health')?.value || '/healthz';
  const envsRaw = document.getElementById('w-envs')?.value || '';
  const envLines = envsRaw.split('\n').filter(l => l.includes('=')).map(l => {
    const [k, ...v] = l.split('=');
    return `        - name: ${k.trim()}\n          value: "${v.join('=').trim()}"`;
  }).join('\n');

  const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  strategy:
    type: ${strategy}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
      - name: ${name}
        image: ${image}
        ports:
        - containerPort: ${port}
        resources:
          requests:
            cpu: ${cpuReq}
            memory: ${memReq}
          limits:
            cpu: ${cpuLim}
            memory: ${memLim}
        livenessProbe:
          httpGet:
            path: ${health}
            port: ${port}
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: ${health}
            port: ${port}
          initialDelaySeconds: 5
          periodSeconds: 10${envLines ? `\n        env:\n${envLines}` : ''}
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  selector:
    app: ${name}
  ports:
  - port: ${port}
    targetPort: ${port}
  type: ClusterIP`;

  const pre = document.getElementById('yaml-preview');
  if (pre) pre.textContent = yaml;
}

function copyYaml() {
  const pre = document.getElementById('yaml-preview');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => toast('📋 YAML copied to clipboard'));
}

// ---- TERMINAL (REAL + SIMULATED) ----
// When server is online: POSTs to /api/terminal which runs kubectl
// When offline: uses local simulation

let termHistory = [];
let termHistIdx = -1;

function initTerminal() {
  const out = document.getElementById('terminal-output');
  if (!out) return;
  const mode = serverOnline ? '⬤ LIVE — running real kubectl commands' : '⬤ SIMULATED — run node server.js to connect';
  const color = serverOnline ? 'var(--green)' : 'var(--amber)';
  out.innerHTML =
    `<span style="color:${color}">${mode}</span>\n` +
    `<span class="t-hdr">Type "help" for available commands. Tab to autocomplete.</span>\n\n`;
}

const AUTOCOMPLETE = [
  'kubectl get pods', 'kubectl get deployments', 'kubectl get services',
  'kubectl get nodes', 'kubectl get namespaces', 'kubectl get pvc',
  'kubectl get events', 'kubectl get ingress', 'kubectl get configmaps',
  'kubectl get secrets', 'kubectl top pods', 'kubectl top nodes',
  'kubectl cluster-info', 'kubectl version', 'kubectl api-resources',
  'kubectl describe pod ', 'kubectl describe deployment ',
  'kubectl logs ', 'kubectl rollout status deployment/',
  'kubectl rollout restart deployment/', 'help', 'clear',
];

async function handleTermInput(e) {
  const input = document.getElementById('term-input');

  // Tab autocomplete
  if (e.key === 'Tab') {
    e.preventDefault();
    const val = input.value;
    const match = AUTOCOMPLETE.find(c => c.startsWith(val) && c !== val);
    if (match) input.value = match;
    return;
  }

  // History navigation
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (termHistIdx < termHistory.length - 1) { termHistIdx++; input.value = termHistory[termHistIdx]; }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (termHistIdx > 0) { termHistIdx--; input.value = termHistory[termHistIdx]; }
    else { termHistIdx = -1; input.value = ''; }
    return;
  }

  if (e.key !== 'Enter') return;

  const cmd = input.value.trim();
  input.value = '';
  if (!cmd) return;

  termHistory.unshift(cmd);
  termHistIdx = -1;

  const out = document.getElementById('terminal-output');
  out.innerHTML += `<span class="t-cmd">$ ${escHtml(cmd)}</span>\n`;

  if (cmd === 'clear') { out.innerHTML = ''; return; }
  if (cmd === 'help')  { out.innerHTML += renderHelp(); out.scrollTop = out.scrollHeight; return; }

  if (serverOnline) {
    // ── REAL: send to server.js ──────────────────────────────
    const args = parseCmd(cmd);
    if (!args.length) return;

    out.innerHTML += `<span class="t-hdr">…</span>`;
    out.scrollTop = out.scrollHeight;

    try {
      const r = await fetch(`${API_BASE}/api/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
      });
      const data = await r.json();

      // Remove the "…" placeholder
      out.innerHTML = out.innerHTML.replace('<span class="t-hdr">…</span>', '');

      if (data.stdout) {
        const lines = data.stdout.split('\n');
        lines.forEach((line, i) => {
          if (line === '') { out.innerHTML += '\n'; return; }
          // First line is often a header
          const cls = i === 0 ? 't-hdr' : isErrorLine(line) ? 't-err' : isWarnLine(line) ? 't-warn' : 't-out';
          out.innerHTML += `<span class="${cls}">${escHtml(line)}</span>\n`;
        });
      }
      if (data.stderr) {
        data.stderr.split('\n').filter(Boolean).forEach(line => {
          out.innerHTML += `<span class="t-err">${escHtml(line)}</span>\n`;
        });
      }
    } catch (err) {
      out.innerHTML = out.innerHTML.replace('<span class="t-hdr">…</span>', '');
      out.innerHTML += `<span class="t-err">Connection error: ${escHtml(err.message)}</span>\n`;
    }
  } else {
        // ── SIMULATED fallback ───────────────────────────────────
    const handler = simCommands[cmd] || simCommands[cmd.split(' ').slice(0,3).join(' ')];
    if (handler) {
      out.innerHTML += handler();
    } else if (cmd.startsWith('kubectl logs')) {
      out.innerHTML += generateLogs(cmd.split(' ')[2] || 'pod');
    } else if (cmd.startsWith('kubectl describe')) {
      out.innerHTML += simDescribe(cmd);
    } else {
      out.innerHTML += `<span class="t-err">command not found: ${escHtml(cmd)}</span>\n<span class="t-hdr">Type "help" for commands, or run node server.js to connect to a real cluster.</span>\n`;
    }
  }

  out.scrollTop = out.scrollHeight;
}