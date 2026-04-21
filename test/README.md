# Testing Guide

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Structure

```
test/
├── README.md              # This file
├── unit/                  # Unit tests
│   ├── index.test.ts      # Main worker tests
│   └── encryption.test.ts # Encryption worker tests
└── integration/           # Integration tests
    └── e2e.test.ts        # End-to-end tests
```

## Writing Tests

Tests use Vitest with the Cloudflare Workers pool. Example:

```typescript
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('My Feature', () => {
  it('should do something', async () => {
    const env = {
      // Mock environment
    };
    
    const request = new Request('https://example.com/');
    const ctx = { 
      waitUntil: vi.fn(), 
      passThroughOnException: vi.fn() 
    };
    
    const response = await worker.fetch(request, env, ctx);
    
    expect(response.status).toBe(200);
  });
});
```

## Test Environment

Tests run in a simulated Workers environment using `@cloudflare/vitest-pool-workers`. This provides:

- Access to Workers runtime APIs (`fetch`, `crypto`, etc.)
- Mock KV bindings (if configured)
- Isolated test execution

## Coverage

Current test coverage focuses on:

- ✅ Request/response handling
- ✅ Header capture
- ✅ Body truncation
- ✅ Error handling
- ✅ Encryption workflow
- ⏳ SIEM integration (requires mock server)
- ⏳ End-to-end scenarios

## Mocking

To mock external services:

```typescript
// Mock fetch for SIEM tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

mockFetch.mockResolvedValueOnce(new Response('OK', { status: 200 }));
```
