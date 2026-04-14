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