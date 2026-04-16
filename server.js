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
