# Request Logger

A Cloudflare Workers application for logging inbound HTTP requests with optional encryption.

**Key characteristic:** ZERO persistent storage. All data is kept in memory and streamed immediately to your SIEM.

## Features

- **Request Logging**: Captures all headers and first N bytes of request body
- **Stream Mode**: Sends logs to SIEM immediately (minimal data loss)
- **Zero Latency Impact**: Uses `ctx.waitUntil()` - doesn't block responses
- **Hybrid Encryption**: RSA-OAEP + AES-GCM for efficient encryption
- **No Disk Ever**: Memory-only, logs never touch disk/KV/storage

## Architecture

```
┌─────────────┐      ┌──────────────────────┐      ┌─────────────┐
│   Client    │─────▶│   Request Logger     │─────▶│  Upstream   │
│             │      │   (This Worker)      │      │   (or 200)  │
└─────────────┘      └──────────────────────┘      └─────────────┘
                            │
                            │ (ctx.waitUntil - async)
                            ▼
                    ┌──────────────────┐
                    │ Capture Request  │
                    │ - Headers        │
                    │ - Body preview   │
                    └──────────────────┘
                            │
                            ▼
                    ┌──────────────────┐
                    │ Encrypt (opt)    │
                    └──────────────────┘
                            │
                            ▼
                    ┌──────────────────┐
                    │ HTTP POST to     │
                    │ SIEM endpoint    │
                    └──────────────────┘
```

**Data flow:** Request → Capture → (Encrypt) → HTTP POST → SIEM

**Zero storage:** No KV, no disk, no queues. If SIEM is down, the log is dropped (but you'll see `[DROPPED]` in worker logs).

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure

```toml
# wrangler.toml
[vars]
UPSTREAM_URL = "https://api.example.com"  # Optional - where to forward requests
MAX_BODY_BYTES = "400"
SIEM_STREAMING_MODE = "stream"
ENABLE_ENCRYPTION = "true"
```

### 3. Set secrets

```bash
# REQUIRED: Your SIEM endpoint
wrangler secret put SIEM_ENDPOINT
# https://your-splunk:8088/services/collector/event
# or https://http-intake.logs.datadoghq.com/v1/input

# Optional: SIEM API key
wrangler secret put SIEM_API_KEY

# Required if encryption enabled
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
wrangler secret put ENCRYPTION_PUBLIC_KEY
# Paste contents of public.pem
```

### 4. Deploy

```bash
wrangler deploy
```

## Log Format

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "requestId": "uuid-v4-string",
  "url": "https://worker.example.com/path",
  "method": "POST",
  "headers": {
    "content-type": "application/json",
    "x-request-id": "abc123"
  },
  "bodyPreview": "{\"key\":\"value\"}... [truncated, total: 1024 bytes]",
  "bodyLength": 1024
}
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `UPSTREAM_URL` | Where to forward requests | - (returns 200 OK) |
| `MAX_BODY_BYTES` | Bytes of body to capture | `400` |
| `SIEM_STREAMING_MODE` | `stream` or `buffer` | `stream` |
| `ENABLE_ENCRYPTION` | Enable encryption | `false` |
| `ENCRYPTION_MODE` | `inline` or `service` | `inline` |

## Testing Without a SIEM (Dry-Run Mode)

If you don't have a SIEM endpoint yet, you can test the logger in **dry-run mode**. Just leave `SIEM_ENDPOINT` unset:

```toml
# wrangler.toml
SIEM_STREAMING_MODE = "stream"
# Don't set SIEM_ENDPOINT - logs will be printed to console
```

Then watch the logs:
```bash
wrangler tail
```

Generate some traffic:
```bash
node scripts/generate-traffic.js -u https://your-worker.workers.dev -c 5 --method POST --payload-size 500
```

You'll see output like:
```
[SIEM STUB][uuid] Would send to SIEM:
{"timestamp":"2024-01-15T...","requestId":"...","url":"...","method":"POST","headers":{...},"bodyPreview":"{\"timestamp\":\"...\"...","bodyLength":500}
```

This shows exactly what would be sent to your SIEM, including the full request body preview.

## Data Loss & Monitoring

Since this uses **zero persistent storage**, logs can be lost:

| Scenario | Risk | What happens |
|----------|------|--------------|
| SIEM down | Log dropped | `[DROPPED]` appears in worker logs |
| Network error | Log dropped | `[SIEM ERROR]` appears in logs |
| Worker crash | Pending logs lost | Use stream mode (sends immediately) |

**Monitor with:**
```bash
wrangler tail
# Look for [DROPPED] or [SIEM ERROR] lines
```

## Encryption

Encrypted payloads use hybrid encryption (RSA-OAEP + AES-GCM):

```json
{
  "ciphertext": "base64...",
  "encryptedKey": "base64...",
  "iv": "base64...",
  "algorithm": "RSA-OAEP-AES256-GCM"
}
```

Decrypt with your private key:
```javascript
// 1. Decrypt AES key with RSA private key
// 2. Decrypt data with AES-GCM
// 3. Parse JSON
```

## Traffic Generator

Use the included script to generate test traffic:

```bash
# Generate 100 requests
node scripts/generate-traffic.js -u https://your-worker.workers.dev

# Generate 1000 requests with 50 concurrent connections
node scripts/generate-traffic.js -u https://your-worker.workers.dev -c 1000 --concurrency 50

# POST requests with 500 byte payload
node scripts/generate-traffic.js -u https://your-worker.workers.dev --method POST --payload-size 500

# All options
node scripts/generate-traffic.js -u <url> \
  [-c, --count <number>] \
  [--concurrency <number>] \
  [--delay <ms>] \
  [--method <GET|POST|PUT|PATCH|DELETE|mixed>] \
  [--payload-size <bytes|random>] \
  [--no-headers]
```

## Development

```bash
npm run dev       # Local development
npm run typecheck # Type checking
npm test          # Run tests
wrangler deploy   # Deploy
```

## License

MIT
