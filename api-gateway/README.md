# API Gateway

A transparent API gateway that logs requests and forwards them to a backend service via service binding.

## How It Works

```
Client → gateway.jsherron.com/path → This Worker → [LOGGED]
                                              ↓
                                    Service Binding
                                              ↓
                                       Backend
                                              ↓
                                    [Response]
                                              ↓
                                        [RETURNED]
```

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

## Deployment

```bash
cd api-gateway
wrangler deploy
```

## Usage Examples

### GET Request with Query Parameters

```bash
curl -X GET "https://gateway.jsherron.com/get?id=123&category=electronics" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer test-token-456"
```

**Expected Response:**
```json
{
  "args": {
    "id": "123",
    "category": "electronics"
  },
  "headers": {
    "accept": "application/json",
    "authorization": "Bearer test-token-456"
  },
  "method": "GET",
  "url": "http://internal/get?id=123&category=electronics"
}
```

### POST Request with JSON Body

```bash
curl -X POST "https://gateway.jsherron.com/post" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: test-123" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "role": "admin"
  }'
```

**Expected Response:**
```json
{
  "args": {},
  "data": "{\"name\": \"John Doe\", \"email\": \"john@example.com\", \"role\": \"admin\"}",
  "json": {
    "name": "John Doe",
    "email": "john@example.com",
    "role": "admin"
  },
  "headers": {
    "content-type": "application/json",
    "x-request-id": "test-123"
  },
  "method": "POST",
  "url": "http://internal/post"
}
```

### Workers.dev URL (Alternative)

If custom domain DNS hasn't propagated yet:

```bash
curl -X POST "https://api-gateway.jsherron-test-account.workers.dev/post" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## View Logs

```bash
wrangler tail api-gateway
```

## Log Format

```json
{
  "timestamp": "2026-04-21T...",
  "requestId": "uuid",
  "originalUrl": "https://gateway.jsherron.com/get?id=123",
  "forwardedTo": "backend:/get?id=123",
  "method": "GET",
  "headers": {...},
  "bodyPreview": "",
  "bodyLength": 0
}
```

## Switching Backends

```bash
# Edit wrangler.toml
# Change: service = "flarebin" to service = "your-worker"

# Redeploy
wrangler deploy

# Done! All traffic now goes to the new backend
```

## Architecture

This gateway demonstrates **transparent interception**:
1. Client calls existing URL pattern
2. Cloudflare routes to this Worker
3. Worker captures request synchronously
4. Worker logs asynchronously
5. Worker forwards to backend via service binding (preserving full path and query)
6. Backend's response returns to client

The client is unaware of the logging - it just sees the backend response.

## Why Service Bindings?

- **Fast**: No HTTP overhead, internal routing
- **Secure**: Never leaves Cloudflare's network
- **Flexible**: Change backend by editing one line in wrangler.toml
- **Zero-downtime**: Switch backends instantly on redeploy
