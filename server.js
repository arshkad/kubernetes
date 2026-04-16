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
    console.error('❌  No kubeconfig found at', kubeconfigPath);
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
    console.error('❌  Could not read kubeconfig:', err.message);
    process.exit(1);
  }
}

const kube = loadKubeConfig();
console.log(`\n✅  Connected to cluster via context: ${kube.context}`);
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
  