/**
 * Encryption utilities - hybrid RSA-OAEP + AES-GCM
 */

export interface EncryptedPayload {
  ciphertext: string;
  encryptedKey: string;
  iv: string;
  algorithm: string;
}

export async function hybridEncrypt(
  plaintext: string,
  publicKeyPem: string,
): Promise<EncryptedPayload> {
  const aesKey = (await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  )) as CryptoKey;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encryptedData = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    data,
  );

  const exportedKey = (await crypto.subtle.exportKey('raw', aesKey)) as ArrayBuffer;
  const publicKey = await importPublicKey(publicKeyPem);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    exportedKey,
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedKey))),
    iv: btoa(String.fromCharCode(...iv)),
    algorithm: 'RSA-OAEP-AES256-GCM',
  };
}

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
    ['encrypt'],
  );
}
