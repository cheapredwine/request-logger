# API Gateway

A transparent API gateway that logs requests and forwards them to a backend service via service binding.

## How It Works

```
Client → gateway.jsherron.com/api/v1/users → This Worker → [LOGGED]
                                                  ↓
                                    Service Binding
                                                  ↓
                                          Backend
                                                  ↓
                                       [Response]
                                                  ↓
                                          [RETURNED]
```

**HTTP Method Mapping:**
- `POST` → backend `/post`
- `GET` → backend `/get`
- `PUT` → backend `/put`
- `PATCH` → backend `/patch`
- `DELETE` → backend `/delete`

## Configuration

### Backend Service

Change the backend by editing `wrangler.toml`:

```toml
[[services]]
binding = "BACKEND"
service = "flarebin"  # Change this to any Worker service
```

To switch backends, just change the `service` name and redeploy:
- `service = "flarebin"` - Use flarebin as backend
- `service = "my-api"` - Use your own API Worker
- `service = "httpbin"` - Use httpbin clone

### Path Filtering

By default, logs all `/api/*` requests except:
- `/api/health` - Health checks
- `/api/metrics` - Monitoring endpoints  
- `/api/static/*` - Static assets

Configure in `wrangler.toml`:
```toml
[vars]
SKIP_PATHS = "/api/health,/api/metrics,/api/static"
```

## Deployment

```bash
# From the api-gateway directory
cd api-gateway

# Deploy
wrangler deploy

# DNS route is automatic via wrangler.toml routes config
```

## Testing

```bash
# This request gets logged and forwarded to backend/post
curl https://gateway.jsherron.com/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"name":"test","email":"test@example.com"}'

# This request is forwarded but NOT logged (health check)
curl https://gateway.jsherron.com/api/health

# View logs
wrangler tail
```

## Switching Backends

```bash
# Edit wrangler.toml
# Change: service = "flarebin" to service = "your-worker"

# Redeploy
wrangler deploy

# Done! All traffic now goes to the new backend
```

## Log Format

```json
{
  "timestamp": "2026-04-21T...",
  "requestId": "uuid",
  "originalUrl": "https://gateway.jsherron.com/api/v1/users",
  "forwardedTo": "backend:/post",
  "method": "POST",
  "headers": {...},
  "bodyPreview": "{\"name\":\"test\"...",
  "bodyLength": 45,
  "logged": true
}
```

## Architecture

This gateway demonstrates **transparent interception**:
1. Client calls existing URL pattern
2. Cloudflare routes to this Worker
3. Worker captures request synchronously
4. Worker logs asynchronously
5. Worker forwards to backend via service binding
6. Backend's response returns to client

The client is unaware of the logging - it just sees the backend response.

## Why Service Bindings?

- **Fast**: No HTTP overhead, internal routing
- **Secure**: Never leaves Cloudflare's network
- **Flexible**: Change backend by editing one line in wrangler.toml
- **Zero-downtime**: Switch backends instantly on redeploy
