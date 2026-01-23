import crypto from 'crypto';
import { Hono } from 'hono';

// Configuration - these should be Environment Variables in production
const TUYA_CONFIG = {
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: 'prfcknctpqmc3c7ptwn4',
  secretKey: '71bfc400a62f4c74abb2a9d24c744bc0',
};

const DEVICE_ID = '2784505598f4abfaaa40';

// Access token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

// Generate HMAC-SHA256 signature for Tuya API requests
function signTuyaRequest(
  method: string,
  path: string,
  body: string,
  accessKey: string,
  secretKey: string,
  accessToken?: string
): { [key: string]: string } {
  const timestamp = Date.now().toString();
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const dataToSign = accessKey + (accessToken || '') + timestamp + stringToSign;
  
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(dataToSign)
    .digest('hex')
    .toUpperCase();
  
  return {
    't': timestamp,
    'sign': signature,
    'client_id': accessKey,
    'sign_method': 'HMAC-SHA256',
  };
}

// Get or refresh access token from Tuya API
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const path = '/v1.0/token?grant_type=1';
  const signHeaders = signTuyaRequest('GET', path, '', TUYA_CONFIG.accessKey, TUYA_CONFIG.secretKey);
  
  const response = await fetch(`${TUYA_CONFIG.baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...signHeaders,
      'signVersion': '2.0',
    },
  });
  
  const result = await response.json<any>();
  
  if (result.success && result.result?.access_token) {
    cachedToken = {
      token: result.result.access_token,
      expiresAt: Date.now() + (result.result.expire_time || 7200) * 1000,
    };
    return cachedToken.token;
  }
  
  throw new Error(`Failed to get access token: ${result.msg || 'Unknown error'}`);
}

// Send command to Tuya device
async function sendCommand(commands: Array<{ code: string; value: any }>): Promise<void> {
  const accessToken = await getAccessToken();
  const path = `/v1.0/devices/${DEVICE_ID}/commands`;
  const body = JSON.stringify({ commands });
  
  const signHeaders = signTuyaRequest('POST', path, body, TUYA_CONFIG.accessKey, TUYA_CONFIG.secretKey, accessToken);
  
  const response = await fetch(`${TUYA_CONFIG.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...signHeaders,
      'access_token': accessToken,
      'signVersion': '2.0',
    },
    body,
  });
  
  const result = await response.json<any>();
  
  if (!result.success) {
    throw new Error(`Failed to control light: ${result.msg} (code: ${result.code})`);
  }
}

async function setLightStatus(status: boolean): Promise<void> {
  await sendCommand([{ code: 'switch_led', value: status }]);
  console.log(`Light turned ${status ? 'ON' : 'OFF'}`);
}

// Set light to blue color
async function setBlueColor(): Promise<void> {
  // H=240 (blue), S=255 (full saturation), V=255 (full brightness)
  await sendCommand([
    { code: 'work_mode', value: 'colour' },
    { code: 'colour_data', value: { h: 240, s: 255, v: 255 } }
  ]);
}

// Use built-in flash scene with blue color (police car effect)
async function setPoliceFlashScene(): Promise<void> {
  // Send flash scene directly without changing work_mode
  await sendCommand([
    { code: 'flash_scene_1', value: { h: 240, s: 255, v: 255 } }
  ]);
}

// Flash light like a police car with blue color
async function flashLight(): Promise<void> {
  console.log('Starting police car flash pattern');
  
  try {
    // Use built-in flash scene for automatic flashing effect
    await setPoliceFlashScene();
    console.log('Police flash scene activated - light will continue flashing until turned off');
  } catch (error) {
    console.log('Flash scene failed, trying static blue color');
    // Fallback to static blue color
    await setBlueColor();
  }
}

// Hono app for HTTP endpoints
const app = new Hono();

app.get('/', (c) => {
  const url = new URL(c.req.url);
  url.searchParams.append('cron', '* * * * *');
  return c.text(`To test the scheduled handler, use "--test-scheduled" flag and run: curl ${url.href}`);
});


// GET /status endpoint: returns the lightbulb's JSON status
app.get('/status', async (c) => {
  try {
    const accessToken = await getAccessToken();
    const path = `/v1.0/devices/${DEVICE_ID}/status`;
    const signHeaders = signTuyaRequest('GET', path, '', TUYA_CONFIG.accessKey, TUYA_CONFIG.secretKey, accessToken);
    const response = await fetch(`${TUYA_CONFIG.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        ...signHeaders,
        'access_token': accessToken,
        'signVersion': '2.0',
      },
    });
    const result = await response.json();
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: error.message || String(error) }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const hour = new Date().getUTCHours();
    console.log(`Cron triggered at ${hour}:00 UTC`);

    try {
      if (hour === 18) {
        // Start flashing at 6 PM - will continue until 11 PM
        await flashLight();
      } else if (hour === 23) {
        // Turn off at 11 PM
        await setLightStatus(false);
      }
    } catch (error) {
      console.error('Error controlling light:', error);
    }
  },
} satisfies ExportedHandler<Env>;