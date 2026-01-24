import { Hono } from 'hono';
import { stream } from "hono/streaming";
import crypto from 'crypto';

declare global {
  // eslint-disable-next-line no-var
  var __MINIFLARE: boolean | undefined;
}

interface Env {
  ASSETS: Fetcher;
  KV: KVNamespace;
  TUYA_ACCESS_KEY: string;
  TUYA_SECRET_KEY: string;
  TUYA_BASE_URL: string;
  TUYA_DEVICE_ID: string;
  AUTH0_CLIENT_ID: string;
  AUTH0_DOMAIN: string;
}

const app = new Hono<{ Bindings: Env }>();

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
async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const path = '/v1.0/token?grant_type=1';
  const signHeaders = signTuyaRequest('GET', path, '', env.TUYA_ACCESS_KEY, env.TUYA_SECRET_KEY);

  const response = await fetch(`${env.TUYA_BASE_URL}${path}`, {
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
async function sendCommand(commands: Array<{ code: string; value: any }>, env: Env): Promise<void> {
  const accessToken = await getAccessToken(env);
  const path = `/v1.0/devices/${env.TUYA_DEVICE_ID}/commands`;
  const body = JSON.stringify({ commands });

  const signHeaders = signTuyaRequest('POST', path, body, env.TUYA_ACCESS_KEY, env.TUYA_SECRET_KEY, accessToken);

  const response = await fetch(`${env.TUYA_BASE_URL}${path}`, {
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
  console.log('Tuya API response:', JSON.stringify(result));
  if (!result.success) {
    console.error('Tuya API command payload on error:', JSON.stringify(commands));
    throw new Error(`Failed to control light: ${result.msg} (code: ${result.code})`);
  }
}

// Simple webapp for sequence input and visualization
// Auth0 JWT and "owner" role check. Serve user.html if authorized, not-logged-in.html otherwise.
import { jwtVerify } from 'jose';


// Block direct access to user.html and not-logged-in.html
app.get('/user.html', (c) => c.text('Forbidden', 403));
app.get('/not-logged-in.html', (c) => c.text('Forbidden', 403));

// Main entry: serve correct HTML based on Auth0 JWT/role
app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const authHeader = c.req.header('Authorization');
  let serveUser = false;
  console.log('[ROUTE /] Incoming request:', {
    url: c.req.url,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    authHeader
  });
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // Use Auth0 JWKS endpoint for signature verification
      const jwksUri = `https://${c.env.AUTH0_DOMAIN}/.well-known/jwks.json`;
      const { createRemoteJWKSet } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUri));
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://${c.env.AUTH0_DOMAIN}/`,
        audience: c.env.AUTH0_CLIENT_ID,
      });
      console.log('[ROUTE /] JWT payload:', payload);
      // Check for owner role in custom claim
      const roles = payload['https://jonbreen.uk/roles'];
      console.log('[ROUTE /] Roles claim:', roles);
      if (Array.isArray(roles) && roles.includes('owner')) {
        serveUser = true;
        console.log('[ROUTE /] User is owner, will serve user.html');
      } else {
        console.log('[ROUTE /] User is not owner, will serve not-logged-in.html');
      }
    } catch (e) {
      console.log('[ROUTE /] JWT verification failed or no owner role:', e);
    }
  } else {
    console.log('[ROUTE /] No valid Authorization header, will serve not-logged-in.html');
  }
  const assetPath = serveUser ? '/user.html' : '/not-logged-in.html';
  console.log(`[ROUTE /] Serving asset: ${assetPath}`);
  return c.env.ASSETS.fetch(new Request(url.origin + assetPath, c.req.raw));
});

// Endpoint to get sequence:morning from KV for webapp loading
app.get('/get-sequence', async (c) => {
  const seq = await c.env.KV.get('sequence:morning', 'json');
  return c.json(seq || {});
});

// Save sequence to KV

app.post('/save-sequence', async (c,) => {
  const body = await c.req.json();
  const key = 'sequence:morning';
  await c.env.KV.put(key, JSON.stringify(body));
  return c.text(`Saved as ${key}`);
});

// POST /bulb/color { hue, saturation, brightness }
app.post('/bulb/color', async (c) => {
  const body = await c.req.json();
  if (body.work_mode === 'white') {
      // White mode: clamp brightness to minimum 25
      let brightness = body.brightness;
      if (brightness < 25) brightness = 25;
      let temperature = (body.temperature !== undefined && body.temperature !== null) ? body.temperature : 255;
      console.log(`[white mode] Requested brightness: ${body.brightness}, sent brightness: ${brightness}, temperature: ${temperature}`);
      await sendCommand([
        { code: 'work_mode', value: 'white' },
        { code: 'bright_value', value: brightness },
        { code: 'temp_value', value: temperature },
        { code: 'switch_led', value: true }
      ], c.env);
      return c.text('Bulb white updated');
  } else {
    // Colour mode: set work_mode, then send colour_data_v2
    const { hue, saturation, brightness } = body;
    // Use same format as async scheduled
    const payload = [
      { code: 'work_mode', value: 'colour' },
      { code: 'colour_data', value: { h: hue, s: saturation, v: brightness } },
      { code: 'switch_led', value: true }
    ];
    console.log('Sending colour_data payload:', JSON.stringify(payload));
    await sendCommand(payload, c.env);
    return c.text('Bulb color updated (colour_data object)');
  }
});

// POST /bulb/power { on }
app.post('/bulb/power', async (c) => {
  const { on } = await c.req.json();
  await sendCommand([
    { code: 'switch_led', value: !!on }
  ], c.env);
  return c.text(`Bulb turned ${on ? 'on' : 'off'}`);
});

// Endpoint to serve Auth0 config to frontend
app.get('/auth0-config', async (c) => {
  return c.json({
    domain: c.env.AUTH0_DOMAIN,
    client_id: c.env.AUTH0_CLIENT_ID
  });
});


export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("Scheduled event triggered at", new Date().toISOString());
    console.log("Raw controller.scheduledTime:", controller.scheduledTime, "=>", new Date(controller.scheduledTime).toISOString());
    // Always use the sequence named 'morning'
    const key = 'sequence:morning';
    const seqData = (await env.KV.get(key, 'json')) as {
      steps: Array<any>;
      startTime: string;
      duration: number;
    } | null;
    if (!seqData || !seqData.steps || !seqData.startTime || !seqData.duration) {
      console.error("Sequence data in KV is missing required fields. Cannot run scheduled event.");
      return;
    }
    console.info(`Found sequence in KV: key=${key}, steps=${seqData.steps.length}, startTime=${seqData.startTime}, duration=${seqData.duration}`);

    // Calculate which step to play using controller.scheduledTime
    // Use scheduledDate directly for UTC comparisons
    const scheduledDate = new Date(controller.scheduledTime);
    // Log timezone offset and date interpretations for debugging
    console.log("Timezone offset (minutes):", scheduledDate.getTimezoneOffset());
    console.log("Scheduled date local:", scheduledDate.toString());
    console.log("Scheduled date UTC:", scheduledDate.toISOString());
    // Parse start time as today in UTC
    const [h, m] = seqData.startTime.split(':').map(Number);
    const start = new Date(Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), scheduledDate.getUTCDate(), h, m, 0, 0));
    const durationMs = seqData.duration * 60 * 1000;
    const end = new Date(start.getTime() + durationMs);
    // Debug logging for time comparison
    console.log("scheduledDate:", scheduledDate.toISOString());
    console.log("sequence window start:", start.toISOString());
    console.log("sequence window end:", end.toISOString());
    if (scheduledDate < start || scheduledDate > end) {
      console.info("Current time is outside the sequence window. No step played.");
      return;
    }

    // Which step?
    const stepCount = seqData.steps.length;
    const elapsedMs = scheduledDate.getTime() - start.getTime();
    const stepIdx = Math.floor(elapsedMs / (durationMs / stepCount));
    if (stepIdx < 0 || stepIdx >= stepCount) {
      console.info("Calculated step index is out of bounds. No step played.");
      return;
    }
    const step = seqData.steps[stepIdx];

    // Build and send command
    let commands;
    if (step.work_mode === 'white') {
      commands = [
        { code: 'work_mode', value: 'white' },
        { code: 'bright_value', value: step.brightness },
        { code: 'temp_value', value: step.temperature },
        { code: 'switch_led', value: step.on }
      ];
    } else if (step.work_mode === 'colour') {
      commands = [
        { code: 'work_mode', value: 'colour' },
        { code: 'colour_data', value: { h: step.hue, s: step.saturation, v: step.brightness } },
        { code: 'switch_led', value: step.on }
      ];
    } else {
      commands = [{ code: 'switch_led', value: step.on }];
    }
    try {
      await sendCommand(commands, env);
      console.info(`Played step ${stepIdx + 1}/${stepCount} at ${scheduledDate.toISOString()}`);
    } catch (error) {
      console.error('Error sending command:', error);
    }
  },
} satisfies ExportedHandler<Env>;