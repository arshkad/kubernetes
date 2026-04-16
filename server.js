#!/usr/bin/env node
// ============================================================
// KubeOps Pro — server.js
// Lightweight proxy: browser to go from and to Kubernetes API
//
// Usage:
//   npm install        (first time only)
//   node server.js     (uses your current kubectl context)
//
// You can open: http://localhost:3001
// ============================================================

const http      = require('http');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const { execSync, spawn } = require('child_process');

const PORT = 3001;

// ── Load kubeconfig ──────────────────────────────────────────
function loadKubeConfig() {
  const kubeconfigPath = process.env.KUBECONFIG ||
    path.join(process.env.HOME || process.env.USERPROFILE, '.kube', 'config');

  if (!fs.existsSync(kubeconfigPath)) {
    console.error(' No kubeconfig found at', kubeconfigPath);
    console.error('    Make sure kubectl is configured and you are logged into a cluster.');
    process.exit(1);
  }

  // Use kubectl to resolve the current context cleanly
  try {
    const server  = execSync('kubectl config view --minify -o jsonpath={.clusters[0].cluster.server}', { encoding: 'utf8' }).trim();
    const caData  = execSync('kubectl config view --raw --minify -o jsonpath={.clusters[0].cluster.certificate-authority-data}', { encoding: 'utf8' }).trim();
    const certData = execSync('kubectl config view --raw --minify -o jsonpath={.users[0].user.client-certificate-data}', { encoding: 'utf8' }).trim();
    const keyData  = execSync('kubectl config view --raw --minify -o jsonpath={.users[0].user.client-key-data}', { encoding: 'utf8' }).trim();
    const token    = (() => { try { return execSync('kubectl config view --raw --minify -o jsonpath={.users[0].user.token}', { encoding: 'utf8' }).trim(); } catch { return ''; } })();
    const context  = execSync('kubectl config current-context', { encoding: 'utf8' }).trim();

    const url = new URL(server);
    return {
      host: url.hostname,
      port: url.port || 443,
      ca:   caData   ? Buffer.from(caData,   'base64') : null,
      cert: certData ? Buffer.from(certData, 'base64') : null,
      key:  keyData  ? Buffer.from(keyData,  'base64') : null,
      token,
      context,
      server,
    };
  } catch (err) {
    console.error(' Could not read kubeconfig:', err.message);
    process.exit(1);
  }
}

const kube = loadKubeConfig();
console.log(`\n Connected to cluster via context: ${kube.context}`);
console.log(`    API server: ${kube.server}\n`);

// ── Forward a request to the Kubernetes API ──────────────────
function k8sRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: kube.host,
      port:     kube.port,
      path:     apiPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      rejectUnauthorized: !!kube.ca,
    };
    if (kube.ca)    opts.ca   = kube.ca;
    if (kube.cert)  opts.cert = kube.cert;
    if (kube.key)   opts.key  = kube.key;
    if (kube.token) opts.headers['Authorization'] = `Bearer ${kube.token}`;
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
// ── Stream logs from kubectl (SSE) ──────────────────────────
function streamLogs(res, namespace, podName, container) {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
  
    const args = ['logs', podName, '-n', namespace, '--follow', '--tail=100', '--timestamps'];
    if (container) args.push('-c', container);
  
    const proc = spawn('kubectl', args);
    proc.stdout.on('data', chunk => {
      chunk.toString().split('\n').filter(Boolean).forEach(line => {
        res.write(`data: ${JSON.stringify({ line })}\n\n`);
      });
    });
    proc.stderr.on('data', chunk => {
      res.write(`data: ${JSON.stringify({ error: chunk.toString() })}\n\n`);
    });
    proc.on('close', () => { res.write('data: {"done":true}\n\n'); res.end(); });
    res.on('close', () => proc.kill());
  }
// ── kubectl exec (terminal) via kubectl subprocess ───────────
function runKubectlCommand(args) {
    return new Promise((resolve) => {
      try {
        const output = execSync(`kubectl ${args.join(' ')}`, {
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 1024 * 512,
        });
        resolve({ stdout: output, stderr: '', exitCode: 0 });
      } catch (err) {
        resolve({
          stdout: err.stdout || '',
          stderr: err.stderr || err.message,
          exitCode: err.status || 1,
        });
      }
    });
  }
  
  // ── Apply YAML via kubectl apply ─────────────────────────────
  function applyYaml(yamlText) {
    return new Promise((resolve) => {
      const tmpFile = path.join(require('os').tmpdir(), `kubeops-${Date.now()}.yaml`);
      try {
        fs.writeFileSync(tmpFile, yamlText, 'utf8');
        const output = execSync(`kubectl apply -f ${tmpFile}`, {
          encoding: 'utf8',
          timeout: 30000,
        });
        fs.unlinkSync(tmpFile);
        resolve({ success: true, output: output.trim() });
      } catch (err) {
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve({ success: false, output: (err.stdout || '') + (err.stderr || err.message) });
      }
    });
  }
  
  // ── MIME types for static files ──────────────────────────────
  const MIME = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.ico':  'image/x-icon',
  };
  
  // ── HTTP server ──────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
  
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  
    const send = (status, data) => {
      const body = typeof data === 'string' ? data : JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };
  
    // ── Read body helper ────────────────────────────────────────
    const readBody = () => new Promise(r => {
      let d = ''; req.on('data', c => d += c); req.on('end', () => r(d));
    });
   // ===== ROUTES =====

  // GET /api/pods?namespace=default
  if (url.pathname === '/api/pods' && req.method === 'GET') {
    const ns = url.searchParams.get('namespace') || 'default';
    const apiNs = ns === 'all' ? '/api/v1/pods' : `/api/v1/namespaces/${ns}/pods`;
    try {
      const r = await k8sRequest('GET', apiNs);
      const pods = (r.body.items || []).map(p => ({
        name:      p.metadata.name,
        namespace: p.metadata.namespace,
        status:    p.status.phase || 'Unknown',
        ready:     `${(p.status.containerStatuses||[]).filter(c=>c.ready).length}/${(p.spec.containers||[]).length}`,
        restarts:  (p.status.containerStatuses||[]).reduce((s,c)=>s+(c.restartCount||0),0),
        node:      p.spec.nodeName || '<none>',
        age:       calcAge(p.metadata.creationTimestamp),
        ip:        p.status.podIP || '—',
        image:     (p.spec.containers||[])[0]?.image || '—',
      }));
      send(200, { pods });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/deployments?namespace=default
  if (url.pathname === '/api/deployments' && req.method === 'GET') {
    const ns = url.searchParams.get('namespace') || 'default';
    const apiNs = ns === 'all'
      ? '/apis/apps/v1/deployments'
      : `/apis/apps/v1/namespaces/${ns}/deployments`;
    try {
      const r = await k8sRequest('GET', apiNs);
      const deployments = (r.body.items || []).map(d => ({
        name:      d.metadata.name,
        namespace: d.metadata.namespace,
        replicas:  d.spec.replicas || 0,
        available: d.status.availableReplicas || 0,
        ready:     d.status.readyReplicas || 0,
        image:     (d.spec.template.spec.containers||[])[0]?.image || '—',
        age:       calcAge(d.metadata.creationTimestamp),
        strategy:  d.spec.strategy?.type || 'RollingUpdate',
      }));
      send(200, { deployments });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/nodes
  if (url.pathname === '/api/nodes' && req.method === 'GET') {
    try {
      const r = await k8sRequest('GET', '/api/v1/nodes');
      const nodes = (r.body.items || []).map(n => {
        const ready = (n.status.conditions||[]).find(c=>c.type==='Ready');
        return {
          name:     n.metadata.name,
          status:   ready?.status === 'True' ? 'Ready' : 'NotReady',
          role:     n.metadata.labels?.['node-role.kubernetes.io/worker'] ? 'worker'
                  : n.metadata.labels?.['node-role.kubernetes.io/control-plane'] ? 'control-plane' : 'worker',
          version:  n.status.nodeInfo?.kubeletVersion || '—',
          os:       n.status.nodeInfo?.osImage || '—',
          cpu:      n.status.capacity?.cpu || '—',
          memory:   n.status.capacity?.memory || '—',
          age:      calcAge(n.metadata.creationTimestamp),
        };
      });
      send(200, { nodes });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/services?namespace=default
  if (url.pathname === '/api/services' && req.method === 'GET') {
    const ns = url.searchParams.get('namespace') || 'default';
    const apiNs = ns === 'all' ? '/api/v1/services' : `/api/v1/namespaces/${ns}/services`;
    try {
      const r = await k8sRequest('GET', apiNs);
      const services = (r.body.items || []).map(s => ({
        name:       s.metadata.name,
        namespace:  s.metadata.namespace,
        type:       s.spec.type,
        clusterIP:  s.spec.clusterIP,
        externalIP: (s.status.loadBalancer?.ingress||[])[0]?.ip || '<none>',
        ports:      (s.spec.ports||[]).map(p=>`${p.port}/${p.protocol}`).join(', '),
        age:        calcAge(s.metadata.creationTimestamp),
      }));
      send(200, { services });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/events?namespace=default
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const ns = url.searchParams.get('namespace') || 'default';
    const apiNs = ns === 'all' ? '/api/v1/events' : `/api/v1/namespaces/${ns}/events`;
    try {
      const r = await k8sRequest('GET', apiNs);
      const evts = (r.body.items || [])
        .sort((a,b) => new Date(b.lastTimestamp||b.eventTime||0) - new Date(a.lastTimestamp||a.eventTime||0))
        .slice(0, 50)
        .map(e => ({
          time:   calcAge(e.lastTimestamp || e.eventTime),
          type:   e.type,
          obj:    `${e.involvedObject.kind}/${e.involvedObject.name}`,
          reason: e.reason,
          msg:    e.message,
          count:  e.count || 1,
        }));
      send(200, { events: evts });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/namespaces
  if (url.pathname === '/api/namespaces' && req.method === 'GET') {
    try {
      const r = await k8sRequest('GET', '/api/v1/namespaces');
      const namespaces = (r.body.items || []).map(n => n.metadata.name);
      send(200, { namespaces });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/logs?pod=...&namespace=...  (SSE stream)
  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const pod       = url.searchParams.get('pod')       || '';
    const namespace = url.searchParams.get('namespace') || 'default';
    const container = url.searchParams.get('container') || '';
    if (!pod) { send(400, { error: 'pod parameter required' }); return; }
    streamLogs(res, namespace, pod, container);
    return;
  }

  // POST /api/terminal  { args: ["get","pods","-n","default"] }
  if (url.pathname === '/api/terminal' && req.method === 'POST') {
    try {
      const body = await readBody();
      const { args } = JSON.parse(body);
      if (!Array.isArray(args)) { send(400, { error: 'args must be an array' }); return; }
      // Safety: only allow read-only + apply commands
      const cmd = args[0] || '';
      const allowed = ['get','describe','top','logs','cluster-info','version','api-resources','explain','apply','rollout'];
      if (!allowed.includes(cmd)) {
        send(403, { stdout: '', stderr: `Command "${cmd}" is not permitted via the web terminal.\nAllowed: ${allowed.join(', ')}`, exitCode: 1 });
        return;
      }
      const result = await runKubectlCommand(args);
      send(200, result);
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // POST /api/apply  { yaml: "..." }
  if (url.pathname === '/api/apply' && req.method === 'POST') {
    try {
      const body = await readBody();
      const { yaml } = JSON.parse(body);
      if (!yaml) { send(400, { error: 'yaml field required' }); return; }
      const result = await applyYaml(yaml);
      send(result.success ? 200 : 422, result);
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // POST /api/scale  { deployment, namespace, replicas }
  if (url.pathname === '/api/scale' && req.method === 'POST') {
    try {
      const body = await readBody();
      const { deployment, namespace, replicas } = JSON.parse(body);
      const args = ['scale', `deployment/${deployment}`, `--replicas=${replicas}`, '-n', namespace || 'default'];
      const result = await runKubectlCommand(args);
      send(result.exitCode === 0 ? 200 : 422, result);
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // POST /api/delete/pod  { name, namespace }
  if (url.pathname === '/api/delete/pod' && req.method === 'POST') {
    try {
      const body = await readBody();
      const { name, namespace } = JSON.parse(body);
      const args = ['delete', 'pod', name, '-n', namespace || 'default', '--grace-period=0'];
      const result = await runKubectlCommand(args);
      send(result.exitCode === 0 ? 200 : 422, result);
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // GET /api/context  — which cluster are we connected to?
  if (url.pathname === '/api/context' && req.method === 'GET') {
    try {
      const ctx     = execSync('kubectl config current-context', { encoding: 'utf8' }).trim();
      const cluster = execSync('kubectl config view --minify -o jsonpath={.clusters[0].cluster.server}', { encoding: 'utf8' }).trim();
      send(200, { context: ctx, server: cluster });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  // Static file serving (serve the dashboard itself)
  if (req.method === 'GET') {
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(__dirname, filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext  = path.extname(filePath);
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }
  send(404, { error: 'Not found' });
});
// ── Helpers ──────────────────────────────────────────────────
function calcAge(timestamp) {
    if (!timestamp) return '—';
    const diff = Date.now() - new Date(timestamp).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m`;
    if (s < 86400) return `${Math.floor(s/3600)}h`;
    return `${Math.floor(s/86400)}d`;
  }
  
  server.listen(PORT, () => {
    console.log(`🚀  KubeOps Pro server running at http://localhost:${PORT}`);
    console.log(`    Dashboard: http://localhost:${PORT}`);
    console.log(`    API:       http://localhost:${PORT}/api/*\n`);
  });