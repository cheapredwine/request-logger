# Request Logger

Cloudflare Workers-based request logging with zero persistent storage.

## Project Structure

```
.
├── request-logger/      # Standalone request logger worker
│   ├── src/
│   ├── wrangler.toml
│   └── README.md
├── api-gateway/         # Transparent gateway with logging
│   ├── src/
│   ├── wrangler.toml
│   └── README.md
├── scripts/             # Shared scripts (traffic generator, demo)
├── test/               # Shared tests
├── package.json        # Root package with scripts
└── AGENTS.md           # Detailed project documentation
```

## Quick Start

### Request Logger (Standalone)
Deploy as a standalone logging endpoint:
```bash
cd request-logger
wrangler deploy
```

See [request-logger/README.md](request-logger/README.md) for details.

### API Gateway (Transparent)
Deploy as a transparent gateway that intercepts and logs:
```bash
cd api-gateway
wrangler deploy
```

See [api-gateway/README.md](api-gateway/README.md) for details.

## Shared Scripts

```bash
# Generate traffic
node scripts/generate-traffic.js -u <url> -c 100

# Demo/test live worker
npm run demo

# Run tests
npm test
```

## License

MIT
