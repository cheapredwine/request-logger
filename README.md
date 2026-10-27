# Request Logger

> ⚠️ **NOT OFFICIAL CLOUDFLARE.** Not affiliated with or endorsed by Cloudflare, Inc.
> NO WARRANTIES, EXPRESS OR IMPLIED. Effectively untested demo code — read everything
> and dry-run before you run. You assume all risk. See [DISCLAIMER.md](./DISCLAIMER.md).


Cloudflare Workers-based request logging with zero persistent storage. Two deployment modes: standalone logging endpoint and transparent API gateway.

**Merged from `cf-request-logger` (v2.0.0)**: Now includes real-time WebSocket + SSE streaming, circular in-memory buffer, web UI, and Cloudflare metadata capture alongside the existing SIEM streaming, encryption, and transparent gateway features.

## Features

- **Two Deployment Modes**
  - `request-logger`: Standalone logging endpoint with optional upstream forwarding
  - `api-gateway`: Transparent gateway that intercepts and logs via service binding
- **Real-Time Streaming**: WebSocket (`/stream/ws`) and SSE (`/stream/sse`) for live log viewing
- **In-Memory Buffer**: Circular buffer with configurable max size (default 1000 entries)
- **SIEM Integration**: Stream logs immediately to external SIEM or buffer to console
- **Encryption**: Hybrid RSA-OAEP + AES-GCM (inline or service-binding mode)
- **Web UI**: Dark-themed live log viewer at `public/client.html`
- **Zero Persistence**: All data in memory only, lost on worker restart

## Project Structure

```
.
├── request-logger/      # Standalone logging endpoint
│   ├── src/
│   │   └── index.ts
│   ├── wrangler.toml
│   └── README.md
├── api-gateway/         # Transparent gateway with logging
│   ├── src/
│   │   └── index.ts
│   ├── wrangler.toml
│   └── README.md
├── shared/              # Shared modules (types, buffer, crypto, streaming, capture)
├── public/
│   └── client.html      # Web UI for live log streaming
├── scripts/             # Traffic generator, demo, validation
├── test/               # Unit and integration tests
├── package.json
├── tsconfig.json
└── AGENTS.md
```

## Quick Start

### Request Logger (Standalone)
```bash
cd request-logger
wrangler deploy
```

### API Gateway (Transparent)
```bash
cd api-gateway
wrangler deploy
```

### Streaming Endpoints (Both Workers)

**WebSocket:**
```javascript
const ws = new WebSocket('wss://your-worker.workers.dev/stream/ws');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'log') console.log('New log:', msg.data);
};
```

**SSE:**
```javascript
const es = new EventSource('https://your-worker.workers.dev/stream/sse');
es.addEventListener('log', (e) => console.log('Log:', JSON.parse(e.data)));
```

### Web UI
Open `public/client.html` in a browser pointed at your worker domain, or serve it locally.

## Shared Scripts

```bash
# Generate traffic
node scripts/generate-traffic.js -u <url> -c 100

# Demo/test live worker
npm run demo

# Run tests
npm test

# Full validation before commit
npm run precommit
```

## License

MIT
