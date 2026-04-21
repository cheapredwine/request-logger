#!/usr/bin/env node
/**
 * Deployment Validation Script
 *
 * Validates that the api-gateway is working correctly after deployment.
 * Run this BEFORE committing changes to ensure live deployment works.
 *
 * Usage:
 *   node scripts/validate-deployment.js [url]
 *
 * Examples:
 *   node scripts/validate-deployment.js
 *   node scripts/validate-deployment.js https://gateway.jsherron.com
 */

const WORKER_URL = process.argv[2] || 'https://gateway.jsherron.com';

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

async function testGETWithQueryParams() {
  log('\n📋 Test 1: GET request with query parameters', 'cyan');

  try {
    const response = await fetch(`${WORKER_URL}/get?id=123&category=electronics`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-token-456',
      },
    });

    if (!response.ok) {
      log(`❌ Failed with status ${response.status}`, 'red');
      return false;
    }

    const data = await response.json();

    // Validate response contains expected data
    if (data.args?.id !== '123' || data.args?.category !== 'electronics') {
      log('❌ Query params not preserved', 'red');
      log(`   Expected: { id: "123", category: "electronics" }`);
      log(`   Got: ${JSON.stringify(data.args)}`);
      return false;
    }

    if (!data.url?.includes('/get?id=123&category=electronics')) {
      log('❌ URL not preserved correctly', 'red');
      log(`   Got: ${data.url}`);
      return false;
    }

    log('✅ GET with query params works', 'green');
    log(`   URL preserved: ${data.url}`);
    return true;
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
    return false;
  }
}

async function testPOSTWithBody() {
  log('\n📋 Test 2: POST request with JSON body', 'cyan');

  const testData = {
    name: 'John Doe',
    email: 'john@example.com',
    role: 'admin',
  };

  try {
    const response = await fetch(`${WORKER_URL}/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'validation-test-123',
      },
      body: JSON.stringify(testData),
    });

    if (!response.ok) {
      log(`❌ Failed with status ${response.status}`, 'red');
      return false;
    }

    const data = await response.json();

    // Validate body was preserved
    if (data.json?.name !== testData.name) {
      log('❌ Request body not preserved', 'red');
      log(`   Expected: ${JSON.stringify(testData)}`);
      log(`   Got: ${JSON.stringify(data.json)}`);
      return false;
    }

    // Validate custom header was preserved
    if (data.headers?.['x-request-id'] !== 'validation-test-123') {
      log('❌ Custom header not preserved', 'red');
      return false;
    }

    log('✅ POST with JSON body works', 'green');
    log(`   Body preserved: ${JSON.stringify(data.json)}`);
    return true;
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
    return false;
  }
}

async function testMethodEndpoints() {
  log('\n📋 Test 3: Different HTTP methods', 'cyan');

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const results = [];

  for (const method of methods) {
    try {
      const endpoint = method.toLowerCase();
      const response = await fetch(`${WORKER_URL}/${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method !== 'GET' ? JSON.stringify({ test: true }) : undefined,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.method === method) {
          results.push({ method, status: '✅' });
        } else {
          results.push({ method, status: '❌', error: 'Wrong method in response' });
        }
      } else {
        results.push({ method, status: '❌', error: `HTTP ${response.status}` });
      }
    } catch (error) {
      results.push({ method, status: '❌', error: error.message });
    }
  }

  const allPassed = results.every((r) => r.status === '✅');

  if (allPassed) {
    log('✅ All HTTP methods work', 'green');
  } else {
    log('❌ Some methods failed:', 'red');
    results
      .filter((r) => r.status === '❌')
      .forEach((r) => log(`   ${r.method}: ${r.error}`, 'red'));
  }

  return allPassed;
}

async function validateDeployment() {
  log('╔══════════════════════════════════════════════════════════╗', 'blue');
  log('║  DEPLOYMENT VALIDATION                                   ║', 'blue');
  log('╚══════════════════════════════════════════════════════════╝', 'blue');
  log(`\nTesting against: ${WORKER_URL}\n`);

  const results = [];

  try {
    results.push(await testGETWithQueryParams());
    results.push(await testPOSTWithBody());
    results.push(await testMethodEndpoints());
  } catch (error) {
    log(`\n❌ Validation error: ${error.message}`, 'red');
    process.exit(1);
  }

  const passed = results.filter((r) => r).length;
  const total = results.length;

  log('\n╔══════════════════════════════════════════════════════════╗', 'blue');
  log(
    `║  RESULTS: ${passed}/${total} tests passed${' '.repeat(28 - String(passed).length - String(total).length)}║`,
    passed === total ? 'green' : 'red'
  );
  log('╚══════════════════════════════════════════════════════════╝', 'blue');

  if (passed !== total) {
    log('\n❌ DEPLOYMENT VALIDATION FAILED', 'red');
    log('   Do not commit until all tests pass.', 'yellow');
    process.exit(1);
  }

  log('\n✅ DEPLOYMENT VALIDATION PASSED', 'green');
  log('   Safe to commit changes.', 'green');
  log('');
}

validateDeployment();
