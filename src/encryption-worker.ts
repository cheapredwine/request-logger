/**
 * Encryption Worker (OPTIONAL)
 *
 * This worker provides optional service-based encryption for compliance
 * scenarios requiring cryptographic isolation. For most use cases, the
 * inline encryption in the main worker is preferred (faster, simpler).
 *
 * WHEN TO USE THIS WORKER:
 * - Regulatory requirements mandate crypto isolation
 * - You need centralized key management across multiple loggers
 * - You want to audit/encrypt logs from multiple sources in one place
 *
 * WHEN NOT TO USE:
 * - Performance is critical (adds ~5-10ms latency per request)
 * - Simplicity is preferred
 * - You can use inline encryption (default)
 *
 * DEPLOYMENT:
 * Deploy this as a separate worker named "encryption-worker" with:
 *   wrangler deploy src/encryption-worker.ts --name encryption-worker
 *
 * Then bind it in the main worker's wrangler.toml:
 *   [[services]]
 *   binding = "ENCRYPTION_WORKER"
 *   service = "encryption-worker"
 *
 * And set in main worker:
 *   ENCRYPTION_MODE = "service"
 */

export interface Env {
  // Public key for RSA encryption (PEM format)
  // Set via: wrangler secret put ENCRYPTION_PUBLIC_KEY
  ENCRYPTION_PUBLIC_KEY: string;

  // Optional: Key version for rotation support
  KEY_VERSION: string;
}

export interface EncryptRequest {
  plaintext: string;
  // Optional: Request hybrid encryption (RSA+AES) for large payloads
  useHybrid?: boolean;
}

export interface EncryptResponse {
  ciphertext: string;
  encryptedKey?: string;  // Only present for hybrid encryption
  iv?: string;            // Only present for hybrid encryption
  keyVersion: string;
  algorithm: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/encrypt') {
      return new Response('Not found', { status: 404 });
    }

    try {
      const body = await request.json<EncryptRequest>();

      if (!body.plaintext) {
        return new Response(JSON.stringify({ error: 'Missing plaintext' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Use hybrid encryption for payloads > 190 bytes (RSA-OAEP limit with 2048-bit key)
      const useHybrid = body.useHybrid !== false && body.plaintext.length > 190;

      let result: EncryptResponse;
      if (useHybrid) {
        result = await hybridEncrypt(body.plaintext, env);
      } else {
        result = await rsaEncrypt(body.plaintext, env);
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Encryption error:', error);
      return new Response(
        JSON.stringify({ error: 'Encryption failed', details: String(error) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};

/**
 * Hybrid encryption: RSA-OAEP for AES key, AES-GCM for data
 * Efficient for large payloads
 */
async function hybridEncrypt(plaintext: string, env: Env): Promise<EncryptResponse> {
  // Generate random AES key
  const aesKey = (await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  )) as CryptoKey;

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt data with AES-GCM
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const encryptedData = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    data
  );

  // Export and encrypt AES key with RSA-OAEP
  const exportedKey = (await crypto.subtle.exportKey('raw', aesKey)) as ArrayBuffer;
  const publicKey = await importPublicKey(env.ENCRYPTION_PUBLIC_KEY);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    exportedKey
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedKey))),
    iv: btoa(String.fromCharCode(...iv)),
    algorithm: 'RSA-OAEP-AES256-GCM',
    keyVersion: env.KEY_VERSION || 'v1',
  };
}

/**
 * Direct RSA-OAEP encryption (for small payloads only)
 * RSA-OAEP with 2048-bit key can encrypt max ~190 bytes
 */
async function rsaEncrypt(plaintext: string, env: Env): Promise<EncryptResponse> {
  const publicKey = await importPublicKey(env.ENCRYPTION_PUBLIC_KEY);

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    data
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    keyVersion: env.KEY_VERSION || 'v1',
    algorithm: 'RSA-OAEP-SHA256',
  };
}

/**
 * Import PEM-formatted RSA public key
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');

  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'spki',
    buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}
