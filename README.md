# Kubebernetes Ops Pro — Kubernetes Dashboard

A production-grade Kubernetes dashboard with **real cluster connectivity**.
The terminal runs actual `kubectl` commands. The deploy wizard applies real YAML.
Falls back to full simulation when no cluster is connected.

---

## Quick Start

### Option A — Simulated (no cluster needed)
```bash
open index.html
```

### Option B — LIVE mode ⭐ (connects to your real cluster)
```bash
node server.js
# then open: http://localhost:3001
```
Requires `kubectl` configured and pointing at a real cluster.
