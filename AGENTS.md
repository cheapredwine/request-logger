# AGENTS.md - Request Logger

## Project Overview

A Cloudflare Workers-based request logger that captures inbound HTTP request headers and body previews with zero persistent storage. Data is streamed immediately to a SIEM or logged to console (dry-run mode).

**Key Characteristics:**
- **Zero storage**: Memory-only, never touches disk/KV
- **Stream mode**: Sends logs immediately (minimal data loss)
- **Encryption**: Optional RSA-OAEP + AES-GCM hybrid encryption
- **Security-focused**: For highly sensitive data that should never persist

## Architecture

```
Client Request → Capture (sync) → Process (async) → SIEM/Console
                     ↓
               Return Response (immediate)
```

**Important**: Request body must be captured synchronously before returning the response, as the stream closes afterward.

## Quick Start

### Prerequisites
- Node.js 18+
- Wrangler CLI authenticated
- Cloudflare account

### Setup
```bash
npm install
```

### Development
```bash
# Local development
npm run dev

# In another terminal, watch logs
wrangler tail

# Run tests
npm test
npm run test:live

# Demo the live worker
npm run demo
```

### Deployment
```bash
# Deploy to Cloudflare
wrangler deploy

# Verify deployment
npm run demo
```

## Project Structure

```
.
├── src/
│   ├── index.ts              # Main worker - captures and logs requests
│   └── encryption-worker.ts  # Optional service-based encryption
├── test/
│   ├── unit/                 # Unit tests (Vitest)
│   └── integration/          # Live integration tests
├── scripts/
│   ├── generate-traffic.js   # Generate load for testing
│   └── test-live.js          # On-demand demo/testing script
├── AGENTS.md                 # This file
├── README.md                 # User documentation
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── wrangler.toml             # Worker configuration
```

## Configuration

### wrangler.toml

Key settings:
```toml
[vars]
UPSTREAM_URL = ""                    # Where to forward requests (optional)
MAX_BODY_BYTES = "400"               # Bytes of body to capture
SIEM_STREAMING_MODE = "stream"       # "stream" or "buffer"
ENABLE_ENCRYPTION = "false"          # Enable encryption
ENCRYPTION_MODE = "inline"           # "inline" or "service"
```

### Secrets (via `wrangler secret put`)

- `SIEM_ENDPOINT`: Where to send logs (optional for dry-run mode)
- `SIEM_API_KEY`: Auth token for SIEM (optional)
- `ENCRYPTION_PUBLIC_KEY`: RSA public key for encryption (required if encryption enabled)

## Testing

### Unit Tests
```bash
npm test
```
Tests the worker logic in isolation using Vitest + Cloudflare Workers pool.

### Live Tests
```bash
# Test the deployed worker
npm run test:live

# Or set custom URL
WORKER_URL=https://your-worker.workers.dev npm run test:live
```

### Demo/On-Demand Testing
```bash
# Quick demo of the live worker
npm run demo

# Generate traffic
node scripts/generate-traffic.js -u https://your-worker.workers.dev -c 100
```

### Manual Testing
```bash
# Start dev server
wrangler dev

# Send test request
curl -X POST http://localhost:8787/test \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'

# Watch logs
wrangler tail
```

## Encryption

### Generate Keys
```bash
# Generate RSA key pair
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# Set public key in worker
wrangler secret put ENCRYPTION_PUBLIC_KEY
# Paste contents of public.pem
```

### Decrypt Logs
Use the private key to decrypt:
```javascript
// 1. Decrypt AES key with RSA private key
// 2. Decrypt payload with AES-GCM
// 3. Parse JSON
```

## Common Tasks

### Verify Body Capture Works
1. Run demo: `npm run demo`
2. Watch logs: `wrangler tail`
3. Look for `bodyPreview` with actual JSON/data
4. Should NOT see: "[Error reading body: TypeError...]"

### Debug Issues
- Check `wrangler tail` for errors
- Look for `[DROPPED]` (SIEM down) or `[SIEM ERROR]` (network issues)
- Verify `SIEM_STREAMING_MODE` and `SIEM_ENDPOINT` settings

### Add New Features
1. Write tests first (TDD)
2. Implement in `src/index.ts`
3. Run `npm run typecheck` to verify types
4. Run `npm test` to verify unit tests
5. Deploy with `wrangler deploy`
6. Run `npm run demo` to verify live

## Development Workflow

1. **Make changes** to `src/index.ts`
2. **Type check**: `npm run typecheck`
3. **Unit test**: `npm test`
4. **Deploy**: `wrangler deploy`
5. **Live test**: `npm run demo`
6. **Commit**: Follow conventional commits (feat:, fix:, docs:, etc.)

## Security Considerations

- **Never commit** private keys (private.pem)
- **Never commit** .env files with secrets
- Use `wrangler secret put` for all secrets
- The `.gitignore` already excludes *.pem files

## Troubleshooting

### "Error reading body: TypeError: Can't read from request stream..."
This means the body was accessed after the response was sent. The fix is to capture the body synchronously in the fetch handler before returning the response.

### Logs not appearing in wrangler tail
- Verify worker is deployed: `wrangler deploy`
- Check observability is enabled in wrangler.toml
- Ensure account_id is set correctly

### SIEM connection failures
- Verify `SIEM_ENDPOINT` secret is set
- Check endpoint is accessible from Cloudflare's network
- Look for `[SIEM ERROR]` in logs

## Links

- Repository: https://github.com/cheapredwine/request-logger
- Deployed Worker: https://request-logger.jsherron-test-account.workers.dev
- Cloudflare Dashboard: https://dash.cloudflare.com
