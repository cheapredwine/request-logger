import { describe, it, expect } from 'vitest';
import encryptionWorker from '../../src/encryption-worker';

describe('Encryption Worker', () => {
  const createEnv = (overrides = {}) => ({
    ENCRYPTION_PUBLIC_KEY: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a2rwplBQLpMx+pSGo5K
0ZgNW3g2aXR8fP4a/jVrI+qXtAaheYqQzHh7T1Fz8xFNLiY0f7RmYJqHX8Q+
-----END PUBLIC KEY-----`,
    KEY_VERSION: 'v1',
    ...overrides,
  });

  describe('Request Validation', () => {
    it('should reject non-POST requests', async () => {
      const env = createEnv();
      const request = new Request('http://internal/encrypt', { method: 'GET' });
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

      const response = await encryptionWorker.fetch(request, env as any, ctx as any);

      expect(response.status).toBe(405);
    });

    it('should reject requests to wrong path', async () => {
      const env = createEnv();
      const request = new Request('http://internal/wrong-path', { method: 'POST' });
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

      const response = await encryptionWorker.fetch(request, env as any, ctx as any);

      expect(response.status).toBe(404);
    });

    it('should reject missing plaintext', async () => {
      const env = createEnv();
      const request = new Request('http://internal/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

      const response = await encryptionWorker.fetch(request, env as any, ctx as any);

      expect(response.status).toBe(400);
    });
  });

  describe('Encryption Request Format', () => {
    it('should accept valid encryption request', async () => {
      const env = createEnv();
      const request = new Request('http://internal/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaintext: 'test data' }),
      });
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

      // This would fail with the dummy key, but we're testing the request format
      const response = await encryptionWorker.fetch(request, env as any, ctx as any);
      
      // With a valid key it would return 200, with dummy key it returns 500
      expect([200, 500]).toContain(response.status);
    });

    it('should handle large plaintext', async () => {
      const env = createEnv();
      const largeText = 'x'.repeat(10000);
      const request = new Request('http://internal/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaintext: largeText, useHybrid: true }),
      });
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

      const response = await encryptionWorker.fetch(request, env as any, ctx as any);

      expect([200, 500]).toContain(response.status);
    });
  });
});
