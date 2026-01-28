import { Hono } from 'hono';
import crypto from 'crypto';
import { jwtVerify } from 'jose';
import sessionHandler from './session-handler';

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

// Logout endpoint: clears the session cookie
app.get('/logout', (c) => {
  // Set session cookie to expired
  c.header('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return c.text('Logged out');
});


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


// Block direct access to user.html and not-logged-in.html
app.get('/user.html', (c) => c.text('Forbidden', 403));
app.get('/not-logged-in.html', (c) => c.text('Forbidden', 403));

// Session check endpoint for frontend
app.get('/session', sessionHandler);

// Main entry: serve correct HTML based on Auth0 JWT/role
app.get('/', async (c) => {
  const url = new URL(c.req.url);
  let serveUser = false;
  // Parse cookies
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').map(v => {
    const idx = v.indexOf('=');
    if (idx === -1) return [v.trim(), ''];
    return [v.slice(0, idx).trim(), v.slice(idx + 1).trim()];
  }));
  const sessionToken = cookies['session'];
  console.log('[ROUTE /] Incoming request:', {
    url: c.req.url,
    cookies,
    sessionToken: sessionToken ? '[present]' : '[absent]'
  });
  if (sessionToken) {
    try {
      const jwksUri = `https://${c.env.AUTH0_DOMAIN}/.well-known/jwks.json`;
      const { createRemoteJWKSet } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUri));
      const { payload } = await jwtVerify(sessionToken, JWKS, {
        issuer: `https://${c.env.AUTH0_DOMAIN}/`,
        audience: c.env.AUTH0_CLIENT_ID,
      });
      console.log('[ROUTE /] JWT payload:', payload);
      const roles = payload['https://jonbreen.uk/roles'];
      console.log('[ROUTE /] Roles claim:', roles);
      if (Array.isArray(roles) && roles.includes('owner')) {
        serveUser = true;
        console.log('[ROUTE /] User is owner, will serve user.html');
      } else {
        console.log('[ROUTE /] User is not owner, will serve not-logged-in.html');
      }
    } catch (e) {
      console.log('[ROUTE /] Session cookie verification failed or no owner role:', e);
    }
  } else {
    console.log('[ROUTE /] No session cookie, will serve not-logged-in.html');
  }
  const assetPath = serveUser ? '/user.html' : '/not-logged-in.html';
  console.log(`[ROUTE /] Serving asset: ${assetPath}`);
  return c.env.ASSETS.fetch(new Request(url.origin + assetPath, c.req.raw));
});

// Get all sequences
app.get('/list-sequences', sessionHandler, async (c) => {
  const list = await c.env.KV.list({ prefix: 'sequence:' });
  const sequences = await Promise.all(
    list.keys.map(async (key) => {
      const data = await c.env.KV.get(key.name, 'json') as any;
      return {
        name: key.name.replace('sequence:', ''),
        enabled: data?.enabled ?? false,
        startTime: data?.startTime || '',
        duration: data?.duration || 60,
        stepCount: data?.steps?.length || 0
      };
    })
  );
  return c.json(sequences);
});

// Get a specific sequence
app.get('/get-sequence/:name', sessionHandler, async (c) => {
  const name = c.req.param('name');
  const seq = await c.env.KV.get(`sequence:${name}`, 'json');
  return c.json(seq || null);
});

// Save sequence to KV
app.post('/save-sequence', sessionHandler, async (c) => {
  const body = await c.req.json();
  const name = body.name || 'morning';
  const key = `sequence:${name}`;
  const data = {
    enabled: body.enabled ?? false,
    startTime: body.startTime,
    duration: body.duration,
    steps: body.steps
  };
  await c.env.KV.put(key, JSON.stringify(data));
  return c.json({ success: true, name });
});

// Delete a sequence
app.delete('/delete-sequence/:name', sessionHandler, async (c) => {
  const name = c.req.param('name');
  await c.env.KV.delete(`sequence:${name}`);
  return c.json({ success: true });
});

// POST /bulb/color { hue, saturation, brightness } or { work_mode: 'scene', sceneNum/sceneId }
app.post('/bulb/color', sessionHandler, async (c) => {
  const body = await c.req.json();
  if (body.work_mode === 'scene') {
    // Scene mode - get scene data from device status and send it
    if (body.sceneId) {
      console.log(`[scene mode] Activating scene: ${body.sceneId}`);
      
      // Get device status to retrieve the scene configuration
      try {
        const accessToken = await getAccessToken(c.env);
        const statusPath = `/v1.0/devices/${c.env.TUYA_DEVICE_ID}/status`;
        const signHeaders = signTuyaRequest('GET', statusPath, '', c.env.TUYA_ACCESS_KEY, c.env.TUYA_SECRET_KEY, accessToken);
        
        const statusResponse = await fetch(`${c.env.TUYA_BASE_URL}${statusPath}`, {
          method: 'GET',
          headers: {
            ...signHeaders,
            'access_token': accessToken,
            'signVersion': '2.0',
          },
        });
        
        const statusResult = await statusResponse.json<any>();
        if (!statusResult.success || !statusResult.result) {
          throw new Error('Failed to get device status');
        }
        
        // Find the scene data for this scene ID
        const deviceStatus = statusResult.result;
        let sceneData = null;
        
        for (const item of deviceStatus) {
          if (item.code === body.sceneId) {
            sceneData = item.value;
            break;
          }
        }
        
        if (!sceneData) {
          return c.json({ error: `Scene ${body.sceneId} not found in device status` }, 400);
        }
        
        console.log(`[scene mode] Found scene data: ${sceneData}`);
        
        // Try sending with work_mode: "scene" first, then scene_data
        const commands = [
          { code: 'work_mode', value: 'scene' },
          { code: 'scene_data', value: sceneData }
        ];
        console.log(`[scene mode] Sending commands:`, JSON.stringify(commands));
        await sendCommand(commands, c.env);
        return c.text('Bulb scene activated');
      } catch (error) {
        console.error('[scene mode] Error:', error);
        return c.json({ error: 'Failed to activate scene' }, 500);
      }
    } else {
      return c.json({ error: 'Must provide sceneId for scene mode' }, 400);
    }
  } else if (body.work_mode === 'white') {
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
app.post('/bulb/power', sessionHandler, async (c) => {
  const { on } = await c.req.json();
  await sendCommand([
    { code: 'switch_led', value: !!on }
  ], c.env);
  return c.text(`Bulb turned ${on ? 'on' : 'off'}`);
});

// GET /bulb/scenes - Get available scenes from the bulb
app.get('/bulb/scenes', sessionHandler, async (c) => {
  try {
    const accessToken = await getAccessToken(c.env);
    const path = `/v1.0/devices/${c.env.TUYA_DEVICE_ID}/status`;
    
    const signHeaders = signTuyaRequest('GET', path, '', c.env.TUYA_ACCESS_KEY, c.env.TUYA_SECRET_KEY, accessToken);
    
    const response = await fetch(`${c.env.TUYA_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        ...signHeaders,
        'access_token': accessToken,
        'signVersion': '2.0',
      },
    });
    
    const result = await response.json<any>();
    
    if (!result.success) {
      throw new Error(`Failed to get device status: ${result.msg}`);
    }
    
    // Return the full status for now so we can see what's available
    return c.json(result.result || []);
  } catch (error) {
    console.error('Error fetching scenes:', error);
    return c.json({ error: 'Failed to fetch scenes' }, 500);
  }
});

// Endpoint to serve Auth0 config to frontend
app.get('/auth0-config', async (c) => {
  return c.json({
    domain: c.env.AUTH0_DOMAIN,
    client_id: c.env.AUTH0_CLIENT_ID
  });
});


  // POST /set-session: Accepts id_token, verifies, sets secure session cookie if owner
  app.post('/set-session', async (c) => {
    const { token } = await c.req.json();
    if (!token) return c.text('Missing token', 400);

    try {
      const jwksUri = `https://${c.env.AUTH0_DOMAIN}/.well-known/jwks.json`;
      const { createRemoteJWKSet } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUri));
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://${c.env.AUTH0_DOMAIN}/`,
        audience: c.env.AUTH0_CLIENT_ID,
      });
      const roles = payload['https://jonbreen.uk/roles'];
      if (!Array.isArray(roles) || !roles.includes('owner')) {
        return c.text('Not authorized', 403);
      }
      // Set secure, httpOnly session cookie
      c.header('Set-Cookie', `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return c.text('Session set');
    } catch (e) {
      return c.text('Invalid token', 401);
    }
  });


export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Get all sequences with 'sequence:' prefix
    const list = await env.KV.list({ prefix: 'sequence:' });
    const scheduledDate = new Date(controller.scheduledTime);
    
    // Process each sequence
    for (const key of list.keys) {
      const seqData = (await env.KV.get(key.name, 'json')) as {
        enabled?: boolean;
        steps: Array<any>;
        startTime: string;
        duration: number;
      } | null;
      
      if (!seqData || !seqData.steps || !seqData.startTime || !seqData.duration) {
        console.error(`Sequence ${key.name} is missing required fields. Skipping.`);
        continue;
      }
      
      // Skip disabled sequences
      if (seqData.enabled === false) {
        continue;
      }
      
      const [h, m] = seqData.startTime.split(':').map(Number);
      const start = new Date(Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), scheduledDate.getUTCDate(), h, m, 0, 0));
      const durationMs = seqData.duration * 60 * 1000;
      const end = new Date(start.getTime() + durationMs);
      
      // Check if current time is within sequence window
      if (scheduledDate < start || scheduledDate > end) {
        continue;
      }

      // Calculate which step to play
      const stepCount = seqData.steps.length;
      const elapsedMs = scheduledDate.getTime() - start.getTime();
      const stepIdx = Math.floor(elapsedMs / (durationMs / stepCount));
      if (stepIdx < 0 || stepIdx >= stepCount) {
        continue;
      }
      const step = seqData.steps[stepIdx];

      // Build and send command
      let commands;
      if (step.work_mode === 'scene') {
        // For scenes, use scene ID codes like flash_scene_1
        if (step.sceneId) {
          commands = [
            { code: step.sceneId, value: true }
          ];
        } else {
          console.error(`Scene step missing sceneId`);
          continue;
        }
        // Include switch_led for first step (always), or for subsequent steps only if turning off
        if (stepIdx === 0 || step.on === false) {
          commands.push({ code: 'switch_led', value: step.on });
        }
      } else if (step.work_mode === 'white') {
        commands = [
          { code: 'work_mode', value: 'white' },
          { code: 'bright_value', value: step.brightness },
          { code: 'temp_value', value: step.temperature }
        ];
        // Include switch_led for first step (always), or for subsequent steps only if turning off
        if (stepIdx === 0 || step.on === false) {
          commands.push({ code: 'switch_led', value: step.on });
        }
      } else if (step.work_mode === 'colour') {
        commands = [
          { code: 'work_mode', value: 'colour' },
          { code: 'colour_data', value: { h: step.hue, s: step.saturation, v: step.brightness } }
        ];
        // Include switch_led for first step (always), or for subsequent steps only if turning off
        if (stepIdx === 0 || step.on === false) {
          commands.push({ code: 'switch_led', value: step.on });
        }
      } else {
        // No color/white/scene mode specified - only control power on first step or if turning off
        if (stepIdx === 0 || step.on === false) {
          commands = [{ code: 'switch_led', value: step.on }];
        } else {
          // Skip this step if no work_mode and not first step and not turning off
          continue;
        }
      }
      try {
        await sendCommand(commands, env);
        console.info(`[${key.name}] Played step ${stepIdx + 1}/${stepCount} at ${scheduledDate.toISOString()}`);
      } catch (error) {
        console.error(`[${key.name}] Error sending command:`, error);
      }
    }
  },
} satisfies ExportedHandler<Env>;