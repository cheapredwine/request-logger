#!/usr/bin/env node
/**
 * Live Worker Test Script
 *
 * Run on-demand tests against the deployed worker to verify body capture works.
 *
 * Usage:
 *   node scripts/test-live.js [worker-url]
 *
 * Examples:
 *   node scripts/test-live.js
 *   node scripts/test-live.js https://your-worker.workers.dev
 */

const WORKER_URL = process.argv[2] || process.env.WORKER_URL || 'https://request-logger.jsherron-test-account.workers.dev';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testJSONBody() {
  log('\n📋 Test 1: JSON Body Capture', 'cyan');

  const body = JSON.stringify({
    event: 'user_login',
    userId: '12345',
    timestamp: new Date().toISOString(),
    metadata: {
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0...',
    },
  });

  const response = await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      'Authorization': 'Bearer test-token-abc123',
    },
    body,
  });

  if (response.status === 200) {
    log('✅ POST with JSON body succeeded', 'green');
    log(`   Body size: ${body.length} bytes`);
    log('   Check wrangler tail - should see "event":"user_login" in bodyPreview');
    return true;
  } else {
    log(`❌ Failed with status ${response.status}`, 'red');
    return false;
  }
}

async function testFormData() {
  log('\n📋 Test 2: Form Data Capture', 'cyan');

  const formData = new URLSearchParams();
  formData.append('username', 'testuser');
  formData.append('action', 'submit_form');
  formData.append('data', 'sensitive-form-data-123');

  const response = await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (response.status === 200) {
    log('✅ POST with form data succeeded', 'green');
    log('   Check wrangler tail - should see form data in bodyPreview');
    return true;
  } else {
    log(`❌ Failed with status ${response.status}`, 'red');
    return false;
  }
}

async function testGETRequest() {
  log('\n📋 Test 3: GET Request (no body)', 'cyan');

  const response = await fetch(`${WORKER_URL}/api/users?page=1&limit=10`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Custom-Header': 'get-request-test',
    },
  });

  if (response.status === 200) {
    log('✅ GET request succeeded', 'green');
    log('   Check wrangler tail - should see headers and empty bodyPreview');
    return true;
  } else {
    log(`❌ Failed with status ${response.status}`, 'red');
    return false;
  }
}

async function testLargeBody() {
  log('\n📋 Test 4: Large Body Truncation', 'cyan');

  const largeBody = JSON.stringify({
    type: 'large_payload',
    data: 'x'.repeat(2000),
    timestamp: new Date().toISOString(),
  });

  const response = await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: largeBody,
  });

  if (response.status === 200) {
    log('✅ POST with large body succeeded', 'green');
    log(`   Body size: ${largeBody.length} bytes`);
    log('   Check wrangler tail - should see "[truncated]" in bodyPreview');
    return true;
  } else {
    log(`❌ Failed with status ${response.status}`, 'red');
    return false;
  }
}

async function testConcurrentRequests() {
  log('\n📋 Test 5: Concurrent Requests', 'cyan');

  const requests = Array.from({ length: 5 }, (_, i) =>
    fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Concurrent-Index': String(i),
      },
      body: JSON.stringify({
        test: 'concurrent',
        index: i,
        timestamp: Date.now(),
      }),
    })
  );

  const responses = await Promise.all(requests);
  const allSuccess = responses.every(r => r.status === 200);

  if (allSuccess) {
    log('✅ All 5 concurrent requests succeeded', 'green');
    log('   Check wrangler tail - should see 5 separate log entries');
    return true;
  } else {
    log(`❌ Some requests failed`, 'red');
    return false;
  }
}

async function runTests() {
  log('╔══════════════════════════════════════════════════════════╗', 'blue');
  log('║  LIVE WORKER TEST SUITE                                  ║', 'blue');
  log('╚══════════════════════════════════════════════════════════╝', 'blue');
  log(`\nTesting against: ${WORKER_URL}\n`);

  const results = [];

  try {
    results.push(await testJSONBody());
    results.push(await testFormData());
    results.push(await testGETRequest());
    results.push(await testLargeBody());
    results.push(await testConcurrentRequests());
  } catch (error) {
    log(`\n❌ Test error: ${error.message}`, 'red');
    process.exit(1);
  }

  const passed = results.filter(r => r).length;
  const total = results.length;

  log('\n╔══════════════════════════════════════════════════════════╗', 'blue');
  log(`║  RESULTS: ${passed}/${total} tests passed${' '.repeat(28 - String(passed).length - String(total).length)}║`, passed === total ? 'green' : 'yellow');
  log('╚══════════════════════════════════════════════════════════╝', 'blue');

  log('\n📋 Next Steps:', 'cyan');
  log('   1. Run: wrangler tail');
  log('   2. Look for logs with bodyPreview containing actual data');
  log('   3. Should NOT see: "[Error reading body: TypeError...]"');
  log('   4. If you see real JSON/data, body capture is working!\n');

  if (passed !== total) {
    process.exit(1);
  }
}

// Handle crypto.randomUUID for Node < 14.17
if (!global.crypto?.randomUUID) {
  global.crypto = {
    ...global.crypto,
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
  };
}

runTests();
