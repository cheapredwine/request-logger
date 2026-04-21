# AGENTS.md - Request Logger

## Project Overview

This repository contains **two** Cloudflare Workers for request logging:

1. **request-logger** - Standalone logging endpoint with optional upstream forwarding
2. **api-gateway** - Transparent gateway that intercepts and logs requests

Both use **zero persistent storage** - data is kept in memory only and streamed to SIEM or logged to console.

**Key Characteristics:**
- **Zero storage**: Memory-only, never touches disk/KV
- **Stream mode**: Sends logs immediately (minimal data loss)
- **Encryption**: Optional RSA-OAEP + AES-GCM hybrid encryption
- **Security-focused**: For highly sensitive data that should never persist

## Architecture

### Request Logger (Standalone)
```
Client → request-logger.workers.dev → Capture → [LOGGED] → Optional Upstream
```

Use this when you can change the client URL or need a dedicated logging endpoint.

### API Gateway (Transparent)
```
Client → gateway.yourdomain.com/* → Capture → [LOGGED] → Backend (service binding)
```

Use this when you want transparent interception without client changes.

## Project Structure

```
.
├── request-logger/         # Standalone logging worker
│   ├── src/
│   │   ├── index.ts
│   │   └── encryption-worker.ts
│   ├── test/
│   ├── wrangler.toml
│   └── README.md
├── api-gateway/            # Transparent gateway worker
│   ├── src/
│   │   └── index.ts
│   ├── wrangler.toml
│   └── README.md
├── scripts/                # Shared utilities
│   ├── generate-traffic.js
│   └── test-live.js
├── package.json            # Root package.json
├── tsconfig.json
├── vitest.config.ts
├── AGENTS.md               # This file
└── README.md               # Root overview
```

## Quick Start

### Prerequisites
- Node.js 18+
- Wrangler CLI authenticated
- Cloudflare account

### Setup
```bash
npm install
```

### Deploy Request Logger (Standalone)
```bash
cd request-logger
wrangler deploy
```

### Deploy API Gateway (Transparent)
```bash
cd api-gateway
wrangler deploy
```

Or from root:
```bash
npm run deploy:logger   # Deploy request-logger
npm run deploy:gateway  # Deploy api-gateway
```

## Configuration

### Request Logger

Key settings in `request-logger/wrangler.toml`:
```toml
[vars]
UPSTREAM_URL = ""                    # Where to forward (optional)
MAX_BODY_BYTES = "400"               # Bytes of body to capture
SIEM_STREAMING_MODE = "stream"       # "stream" or "buffer"
ENABLE_ENCRYPTION = "false"          # Enable encryption
```

### API Gateway

Key settings in `api-gateway/wrangler.toml`:
```toml
# Custom domain - automatically creates DNS record
[[routes]]
pattern = "gateway.yourdomain.com"
custom_domain = true

# Service binding to backend
[[services]]
binding = "BACKEND"
service = "flarebin"  # Change to your backend service

[vars]
MAX_BODY_BYTES = "400"
SIEM_STREAMING_MODE = "stream"
```

### Secrets (via `wrangler secret put`)

For either worker:
- `SIEM_ENDPOINT`: Where to send logs (optional for dry-run)
- `SIEM_API_KEY`: Auth token for SIEM (optional)
- `ENCRYPTION_PUBLIC_KEY`: RSA public key (required if encryption enabled)

## Testing

### Unit Tests (request-logger)
```bash
npm test
```

### Live Tests
```bash
# Test request-logger
npm run test:live

# Or with custom URL
WORKER_URL=https://your-worker.workers.dev npm run test:live
```

### Demo/On-Demand Testing
```bash
# Quick demo
npm run demo

# Generate traffic
node scripts/generate-traffic.js -u https://your-worker.workers.dev -c 100
```

### Manual Testing

**Request Logger:**
```bash
cd request-logger
wrangler dev

# In another terminal
curl -X POST http://localhost:8787/test \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
```

**API Gateway:**
```bash
cd api-gateway
wrangler dev

# Test via workers.dev subdomain
curl https://api-gateway.your-account.workers.dev/api/test \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
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
2. Implement in the appropriate worker directory
3. Run `npm run typecheck` to verify types
4. Run `npm test` to verify unit tests
5. Deploy with `npm run deploy:logger` or `npm run deploy:gateway`
6. Run `npm run demo` to verify live

## Development Workflow

### Before Committing ANY Changes

**Required steps for api-gateway:**
```bash
# 1. Make your changes to api-gateway/src/index.ts

# 2. Type check
npm run typecheck

# 3. Run unit tests
npm test

# 4. Deploy to workers.dev
npm run deploy:gateway

# 5. VALIDATE LIVE DEPLOYMENT (CRITICAL)
npm run validate:gateway:dev
# This tests the ACTUAL deployed worker with real HTTP requests
# Must pass before committing!

# 6. Only if validation passes, commit
git add -A
git commit -m "feat: your changes"
```

### For Custom Domain (Production)

After workers.dev validation passes:
```bash
# Deploy to custom domain
npm run deploy:gateway

# Validate production deployment
npm run validate:gateway

# Check logs
wrangler tail api-gateway
```

### Shortcut
```bash
# Run all checks (typecheck + test + validate)
npm run precommit
```

### Never Commit Without Testing

The `validate:gateway:dev` script tests:
- ✅ GET requests with query params preserved
- ✅ POST requests with JSON body preserved
- ✅ All HTTP methods (GET, POST, PUT, PATCH, DELETE)
- ✅ Custom headers preserved

**If validation fails, fix the issue before committing!**

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

### API Gateway custom domain not working
- DNS record should be created automatically with `custom_domain = true`
- If not, check SSL/TLS settings in Cloudflare dashboard
- Ensure the zone is orange-clouded

## Links

- Repository: https://github.com/cheapredwine/request-logger
- Request Logger: https://request-logger.jsherron-test-account.workers.dev
- API Gateway: https://api-gateway.jsherron-test-account.workers.dev
- Cloudflare Dashboard: https://dash.cloudflare.com
