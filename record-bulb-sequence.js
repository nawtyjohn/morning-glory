// Pure Node.js interactive CLI for recording bulb state sequences
// This script does NOT use TypeScript features or imports, only Node.js built-ins
// Run with: node record-bulb-sequence.js


const https = require('https');
const crypto = require('crypto');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Tuya API config (replace with your real values if needed)
const TUYA_CONFIG = {
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: 'XXXXXXXXXXXXXXXX',
  secretKey: 'XXXXXXXXXXXXXXXXXXXXX',
};
const DEVICE_ID = 'XXXXXXXXXXXXXXXXXXX';

let cachedToken = null;

function signTuyaRequest(method, path, body, accessKey, secretKey, accessToken) {
  const timestamp = Date.now().toString();
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const dataToSign = accessKey + (accessToken || '') + timestamp + stringToSign;
  const signature = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('hex').toUpperCase();
  return {
    't': timestamp,
    'sign': signature,
    'client_id': accessKey,
    'sign_method': 'HMAC-SHA256',
  };
}

function tuyaFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(TUYA_CONFIG.baseUrl + path);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const path = '/v1.0/token?grant_type=1';
  const signHeaders = signTuyaRequest('GET', path, '', TUYA_CONFIG.accessKey, TUYA_CONFIG.secretKey);
  const result = await tuyaFetch(path, {
    method: 'GET',
    headers: {
      ...signHeaders,
      'signVersion': '2.0',
    },
  });
  if (result.success && result.result && result.result.access_token) {
    cachedToken = {
      token: result.result.access_token,
      expiresAt: Date.now() + (result.result.expire_time || 7200) * 1000,
    };
    return cachedToken.token;
  }
  throw new Error('Failed to get Tuya access token: ' + (result.msg || 'Unknown error'));
}

async function getBulbStatus() {
  const accessToken = await getAccessToken();
  const path = `/v1.0/devices/${DEVICE_ID}/status`;
  const signHeaders = signTuyaRequest('GET', path, '', TUYA_CONFIG.accessKey, TUYA_CONFIG.secretKey, accessToken);
  const result = await tuyaFetch(path, {
    method: 'GET',
    headers: {
      ...signHeaders,
      'access_token': accessToken,
      'signVersion': '2.0',
    },
  });
  if (!result.success) throw new Error('Tuya API error: ' + (result.msg || 'Unknown error'));
  const statusArr = result.result || [];
  const state = {};
  let workMode = undefined;
  let colorObj = undefined;
  for (const item of statusArr) {
    if (item.code === 'switch_led') state.on = item.value;
    if (item.code === 'work_mode') {
      workMode = item.value;
    }
    if (item.code === 'bright_value') state.brightness = item.value;
    if (item.code === 'temp_value') state.temperature = item.value;
    if (item.code === 'colour_data') {
      try {
        colorObj = JSON.parse(item.value);
      } catch {
        colorObj = item.value;
      }
    }
  }
  if (workMode === 'white') {
    // Only keep brightness and temperature
    return {
      on: state.on,
      work_mode: 'white',
      brightness: state.brightness,
      temperature: state.temperature
    };
  } else if (workMode === 'colour' && colorObj) {
    // Only keep hue, saturation, brightness
    return {
      on: state.on,
      work_mode: 'colour',
      hue: colorObj.h,
      saturation: colorObj.s,
      brightness: colorObj.v
    };
  } else {
    // Fallback: just return on and work_mode
    return {
      on: state.on,
      work_mode: workMode
    };
  }
}

async function main() {
  const sequence = [];
  const startTime = Date.now();
  console.log('--- Bulb Sequence Recorder ---');
  console.log('Instructions:');
  console.log('  Press ENTER to record the current bulb state.');
  console.log('  Type q and press ENTER to stop and save the sequence.');

  // Startup check: try to fetch bulb status once
  try {
    const testState = await getBulbStatus();
    console.log('Successfully connected to Tuya and fetched bulb status:', testState);
  } catch (e) {
    console.error('ERROR: Unable to fetch bulb status from Tuya. Check your credentials, device ID, and network.');
    console.error(e);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Record (ENTER) or quit (q + ENTER): '
  });

  rl.prompt();
  rl.on('line', async (input) => {
    if (input.trim().toLowerCase() === 'q') {
      rl.close();
      return;
    }
    try {
      const state = await getBulbStatus();
      const timestamp = Date.now() - startTime;
      sequence.push({ state, timestamp });
      console.log('Recorded:', state);
    } catch (e) {
      console.error('Failed to record state:', e);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    const seq = {
      steps: sequence,
      recordedAt: new Date().toISOString(),
    };
    const outPath = path.join(process.cwd(), `bulb-sequence-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(seq, null, 2));
    console.log('Sequence saved to', outPath);
    process.exit(0);
  });
}

main();
