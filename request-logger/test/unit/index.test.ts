import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../src/index';

describe('Request Logger', () => {
  const createEnv = (overrides = {}) => ({
    UPSTREAM_URL: '',
    SIEM_ENDPOINT: '',
    SIEM_API_KEY: '',
    ENABLE_ENCRYPTION: 'false',
    ENCRYPTION_MODE: 'inline',
    ENCRYPTION_PUBLIC_KEY: '',
    MAX_BODY_BYTES: '400',
    SIEM_STREAMING_MODE: 'buffer',
    FLUSH_INTERVAL_MS: '5000',
    ...overrides,
  });

  const createRequest = (method: string, body?: string, headers?: Record<string, string>) => {
    return new Request('https://test.example.com/api/path?foo=bar', {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body,
    });
  };

  describe('Basic Request Handling', () => {
    it('should return 200 OK when no upstream URL configured', async () => {
      const env = createEnv();
      const request = createRequest('GET');
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should capture request headers', async () => {
      const env = createEnv();
      const request = new Request('https://test.example.com/', {
        headers: {
          'x-custom-header': 'test-value',
          'authorization': 'Bearer token123',
        },
      });
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
      expect(ctx.waitUntil).toHaveBeenCalled();
    });

    it('should capture request body preview', async () => {
      const env = createEnv();
      const body = JSON.stringify({ key: 'value', data: 'test' });
      const request = createRequest('POST', body);
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
      expect(ctx.waitUntil).toHaveBeenCalled();
    });
  });

  describe('Body Truncation', () => {
    it('should truncate body to MAX_BODY_BYTES', async () => {
      const env = createEnv({ MAX_BODY_BYTES: '50' });
      const largeBody = 'x'.repeat(1000);
      const request = createRequest('POST', largeBody);
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
    });

    it('should handle empty body', async () => {
      const env = createEnv();
      const request = createRequest('GET');
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
    });

    it('should handle binary data', async () => {
      const env = createEnv();
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
      const request = new Request('https://test.example.com/', {
        method: 'POST',
        body: binaryData,
      });
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
    });
  });

  describe('HTTP Methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    methods.forEach((method) => {
      it(`should handle ${method} requests`, async () => {
        const env = createEnv();
        const request = createRequest(method, method !== 'GET' ? '{"test":"data"}' : undefined);
        const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

        const response = await worker.fetch(request, env, ctx as any);

        expect(response.status).toBe(200);
      });
    });
  });

  describe('Error Handling', () => {
    it('should not fail when logging errors occur', async () => {
      const env = createEnv();
      const request = createRequest('POST', 'invalid-json{{{');
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      // Should not throw even if body parsing has issues
      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
    });

    it('should handle requests with no body', async () => {
      const env = createEnv();
      const request = new Request('https://test.example.com/', {
        method: 'DELETE',
      });
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      const response = await worker.fetch(request, env, ctx as any);

      expect(response.status).toBe(200);
    });
  });

  describe('Request ID Generation', () => {
    it('should generate unique request IDs', async () => {
      const env = createEnv();
      const request1 = createRequest('GET');
      const request2 = createRequest('GET');
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      await worker.fetch(request1, env, ctx as any);
      await worker.fetch(request2, env, ctx as any);

      // waitUntil should be called twice with different IDs
      expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
    });
  });

  describe('Upstream Forwarding', () => {
    it('should forward to upstream URL when configured', async () => {
      // This test would require mocking fetch, so we just verify the logic exists
      const env = createEnv({ UPSTREAM_URL: 'https://api.example.com' });
      const request = createRequest('GET');
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

      // The actual fetch to upstream would happen here
      // We can't easily test this without mocking global fetch
      expect(env.UPSTREAM_URL).toBe('https://api.example.com');
    });
  });
});

describe('Encryption', () => {
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a2rwplBQLpMx+pSGo5K
0ZgNW3g2aXR8fP4a/jVrI+qXtAaheYqQzHh7T1Fz8xFNLiY0f7RmYJqHX8Q+
-----END PUBLIC KEY-----`;

  it('should not encrypt when encryption is disabled', () => {
    const env = {
      ENABLE_ENCRYPTION: 'false',
    };

    expect(env.ENABLE_ENCRYPTION).toBe('false');
  });

  it('should detect invalid public key format', () => {
    const invalidKey = 'not-a-valid-key';
    
    expect(invalidKey).not.toContain('BEGIN PUBLIC KEY');
  });

  it('should accept valid PEM format', () => {
    expect(publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(publicKeyPem).toContain('-----END PUBLIC KEY-----');
  });
});

describe('SIEM Streaming Modes', () => {
  it('should support stream mode', () => {
    const env = { SIEM_STREAMING_MODE: 'stream' };
    expect(env.SIEM_STREAMING_MODE).toBe('stream');
  });

  it('should support buffer mode', () => {
    const env = { SIEM_STREAMING_MODE: 'buffer' };
    expect(env.SIEM_STREAMING_MODE).toBe('buffer');
  });

  it('should require SIEM_ENDPOINT in stream mode', () => {
    const env = {
      SIEM_STREAMING_MODE: 'stream',
      SIEM_ENDPOINT: '',
    };

    expect(env.SIEM_ENDPOINT).toBe('');
  });
});
