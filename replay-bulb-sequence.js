// Replay a bulb sequence from a JSON file, sending commands to Tuya API
// Usage: node replay-bulb-sequence.js <sequence.json> <delaySeconds>

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// Tuya API config (replace with your real values if needed)
const TUYA_CONFIG = {
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: 'prfcknctpqmc3c7ptwn4',
  secretKey: '71bfc400a62f4c74abb2a9d24c744bc0',
};
const DEVICE_ID = '2784505598f4abfaaa40';

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

async function sendCommand(commands) {
  const accessToken = await getAccessToken();
  const path = `/v1.0/devices/${DEVICE_ID}/commands`;
  const body = JSON.stringify({ commands });
  const signHeaders = signTuyaRequest('POST', path, body, TUYA_CONFIG.accessKey, TUYA_CONFIG.secretKey, accessToken);
  const result = await tuyaFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...signHeaders,
      'access_token': accessToken,
      'signVersion': '2.0',
    },
    body,
  });
  if (!result.success) throw new Error('Failed to control bulb: ' + (result.msg || result.code));
}

function buildCommands(step) {
  if (step.work_mode === 'white') {
    return [
      { code: 'work_mode', value: 'white' },
      { code: 'bright_value', value: step.brightness },
      { code: 'temp_value', value: step.temperature },
      { code: 'switch_led', value: step.on }
    ];
  } else if (step.work_mode === 'colour') {
    return [
      { code: 'work_mode', value: 'colour' },
      { code: 'colour_data', value: { h: step.hue, s: step.saturation, v: step.brightness } },
      { code: 'switch_led', value: step.on }
    ];
  } else {
    return [{ code: 'switch_led', value: step.on }];
  }
}

async function replaySequence(sequencePath, delaySeconds) {
  const sequence = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
  const steps = sequence.steps || [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const commands = buildCommands(step);
    console.log(`Step ${i + 1}:`, JSON.stringify(commands));
    try {
      await sendCommand(commands);
      console.log('Command sent successfully.');
    } catch (e) {
      console.error('Error sending command:', e);
    }
    if (i < steps.length - 1) {
      await new Promise(res => setTimeout(res, delaySeconds * 1000));
    }
  }
  console.log('Sequence replay complete.');
}

// Entry point
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node replay-bulb-sequence.js <sequence.json> <delaySeconds>');
  process.exit(1);
}
replaySequence(args[0], Number(args[1]));
