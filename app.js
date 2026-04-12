// ============================================
// KubeOps Pro — app.js
// Full Kubernetes Dashboard Simulator
// ============================================

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