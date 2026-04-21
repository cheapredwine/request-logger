#!/usr/bin/env node
/**
 * Traffic Generator for Request Logger
 *
 * Generates HTTP traffic to test the request logger worker.
 *
 * Usage:
 *   node scripts/generate-traffic.js [options]
 *
 * Options:
 *   --url, -u        Target URL (required)
 *   --count, -c      Number of requests (default: 100)
 *   --concurrency    Concurrent requests (default: 10)
 *   --delay          Delay between batches in ms (default: 100)
 *   --method         HTTP method (default: mixed)
 *   --payload-size   Body size in bytes (default: random 100-1000)
 *   --headers        Send random headers (default: true)
 *
 * Examples:
 *   node scripts/generate-traffic.js -u https://your-worker.workers.dev
 *   node scripts/generate-traffic.js -u https://your-worker.workers.dev -c 1000 -c 50
 *   node scripts/generate-traffic.js -u https://your-worker.workers.dev --method POST --payload-size 500
 */

const https = require('https');
const http = require('http');

// Parse arguments
const args = process.argv.slice(2);
const options = {
  url: getArg(args, ['--url', '-u']),
  count: parseInt(getArg(args, ['--count', '-c']) || '100', 10),
  concurrency: parseInt(getArg(args, ['--concurrency']) || '10', 10),
  delay: parseInt(getArg(args, ['--delay']) || '100', 10),
  method: getArg(args, ['--method']) || 'mixed',
  payloadSize: getArg(args, ['--payload-size']) || 'random',
  headers: !args.includes('--no-headers'),
};

if (!options.url) {
  console.error('Error: --url is required');
  console.error('\nUsage: node scripts/generate-traffic.js -u https://your-worker.workers.dev');
  process.exit(1);
}

const parsedUrl = new URL(options.url);
const client = parsedUrl.protocol === 'https:' ? https : http;

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
  'curl/7.68.0',
  'PostmanRuntime/7.28.4',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'python-requests/2.25.1',
];

const contentTypes = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
  'application/xml',
];

let completed = 0;
let failed = 0;
let startTime = Date.now();

function getArg(args, flags) {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1]) {
      return args[index + 1];
    }
  }
  return undefined;
}

function generatePayload(size) {
  const targetSize = size === 'random' ? Math.floor(Math.random() * 900) + 100 : parseInt(size, 10);
  const data = {
    timestamp: new Date().toISOString(),
    id: crypto.randomUUID(),
    message: 'Test payload for request logger',
    data: 'x'.repeat(Math.max(0, targetSize - 100)),
  };
  return JSON.stringify(data);
}

function generateHeaders() {
  if (!options.headers) return {};

  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Request-ID': crypto.randomUUID(),
    'X-Custom-Header': `value-${Math.floor(Math.random() * 1000)}`,
    ...(Math.random() > 0.5 && { 'Authorization': `Bearer token-${Math.floor(Math.random() * 10000)}` }),
    ...(Math.random() > 0.5 && { 'X-Forwarded-For': `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` }),
  };
}

function makeRequest() {
  const method = options.method === 'mixed'
    ? methods[Math.floor(Math.random() * methods.length)]
    : options.method.toUpperCase();

  const payload = generatePayload(options.payloadSize);
  const headers = {
    ...generateHeaders(),
    'Content-Type': contentTypes[Math.floor(Math.random() * contentTypes.length)],
    'Content-Length': Buffer.byteLength(payload),
  };

  const requestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method,
    headers,
  };

  return new Promise((resolve) => {
    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        completed++;
        resolve({ success: true, status: res.statusCode });
      });
    });

    req.on('error', (err) => {
      failed++;
      resolve({ success: false, error: err.message });
    });

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      req.write(payload);
    }

    req.end();
  });
}

async function runBatch(batchSize) {
  const promises = [];
  for (let i = 0; i < batchSize; i++) {
    promises.push(makeRequest());
  }
  await Promise.all(promises);
}

async function run() {
  console.log(`\n🚀 Traffic Generator`);
  console.log(`Target: ${options.url}`);
  console.log(`Requests: ${options.count}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log(`Method: ${options.method}`);
  console.log(`Headers: ${options.headers ? 'enabled' : 'disabled'}`);
  console.log('');

  const batches = Math.ceil(options.count / options.concurrency);

  for (let i = 0; i < batches; i++) {
    const remaining = options.count - (i * options.concurrency);
    const batchSize = Math.min(options.concurrency, remaining);

    process.stdout.write(`\r📡 Batch ${i + 1}/${batches} (${completed}/${options.count} completed, ${failed} failed)`);

    await runBatch(batchSize);

    if (i < batches - 1 && options.delay > 0) {
      await new Promise(r => setTimeout(r, options.delay));
    }
  }

  const duration = Date.now() - startTime;
  const rps = (completed / (duration / 1000)).toFixed(2);

  console.log('\n');
  console.log('✅ Done!');
  console.log(`   Completed: ${completed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Duration: ${duration}ms`);
  console.log(`   RPS: ${rps}`);
  console.log('');
}

// Handle crypto.randomUUID for Node < 14.17
if (!crypto.randomUUID) {
  crypto.randomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
}

run().catch(console.error);
