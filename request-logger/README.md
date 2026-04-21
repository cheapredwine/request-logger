# Request Logger

Standalone request logging worker. Deploy this to log requests and optionally forward to an upstream URL.

## Usage

### Deploy
```bash
cd request-logger
wrangler deploy
```

### Configuration

Edit `wrangler.toml`:
```toml
[vars]
UPSTREAM_URL = ""           # Where to forward (optional)
MAX_BODY_BYTES = "400"      # Body bytes to capture
SIEM_STREAMING_MODE = "stream"
ENABLE_ENCRYPTION = "false"
```

### Test
```bash
# With upstream URL set - forwards to that URL
curl https://request-logger.your-account.workers.dev/api/test

# Without upstream URL - returns 200 OK
curl -X POST https://request-logger.your-account.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
```

### View Logs
```bash
wrangler tail
```

## Features

- Captures request headers and body preview
- Streams logs to SIEM or console (dry-run mode)
- Optional RSA-OAEP + AES-GCM encryption
- Zero persistent storage (memory only)
