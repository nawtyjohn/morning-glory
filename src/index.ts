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
async function sendCommand(
  commands: Array<{ code: string; value: any }>,
  env: Env,
  options: { logErrors?: boolean } = {}
): Promise<void> {
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
    if (options.logErrors !== false) {
      console.error('Tuya API command payload on error:', JSON.stringify(commands));
    }
    throw new Error(`Failed to control light: ${result.msg} (code: ${result.code})`);
  }
}

function normalizeSceneData(sceneData: unknown): unknown {
  if (typeof sceneData === 'string') {
    try {
      return JSON.parse(sceneData);
    } catch {
      return sceneData;
    }
  }
  return sceneData;
}

function clampSceneValue(sceneValue: unknown): { h: number; s: number; v: number } | null {
  if (!sceneValue || typeof sceneValue !== 'object') return null;
  const raw = sceneValue as { h?: unknown; s?: unknown; v?: unknown };
  const h = Number(raw.h);
  const s = Number(raw.s);
  const v = Number(raw.v);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(v)) return null;
  return {
    h: Math.min(360, Math.max(1, Math.round(h))),
    s: Math.min(255, Math.max(1, Math.round(s))),
    v: Math.min(255, Math.max(1, Math.round(v)))
  };
}

async function buildSceneCommandSets(
  params: { sceneId?: string; sceneData?: unknown; sceneValue?: unknown; on?: boolean; allowSwitch?: boolean },
  env: Env
): Promise<Array<Array<{ code: string; value: any }>>> {
  const sceneId = params.sceneId;
  const switchOn = params.on ?? true;
  const allowSwitch = params.allowSwitch ?? true;
  const directSceneData = params.sceneData ?? params.sceneValue;

  if (sceneId) {
    if (sceneId.startsWith('flash_scene_')) {
      const candidateValues: Array<unknown> = [];
      const accessToken = await getAccessToken(env);
      const statusPath = `/v1.0/devices/${env.TUYA_DEVICE_ID}/status`;
      const signHeaders = signTuyaRequest('GET', statusPath, '', env.TUYA_ACCESS_KEY, env.TUYA_SECRET_KEY, accessToken);
      const statusResponse = await fetch(`${env.TUYA_BASE_URL}${statusPath}`, {
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
      const deviceStatus = statusResult.result as Array<{ code: string; value: unknown }>;
      const statusMatch = deviceStatus.find((item) => item.code === sceneId);
      if (statusMatch && statusMatch.value !== undefined) {
        const statusValue = normalizeSceneData(statusMatch.value);
        candidateValues.push(statusValue);
      }

      if (!candidateValues.length) {
        const normalizedDirect = normalizeSceneData(directSceneData);
        const directSceneValue = clampSceneValue(normalizedDirect) ?? normalizedDirect;
        if (directSceneValue) {
          candidateValues.push(directSceneValue);
        }
      }

      if (!candidateValues.length) {
        throw new Error(`Scene ${sceneId} requires a value`);
      }

      return candidateValues.flatMap((sceneValue) => {
        const base = [[{ code: sceneId, value: sceneValue }]];
        if (!allowSwitch) {
          return base;
        }
        return base.concat([
          [
            { code: sceneId, value: sceneValue },
            { code: 'switch_led', value: switchOn }
          ]
        ]);
      });
    }

    const accessToken = await getAccessToken(env);
    const statusPath = `/v1.0/devices/${env.TUYA_DEVICE_ID}/status`;
    const signHeaders = signTuyaRequest('GET', statusPath, '', env.TUYA_ACCESS_KEY, env.TUYA_SECRET_KEY, accessToken);

    const statusResponse = await fetch(`${env.TUYA_BASE_URL}${statusPath}`, {
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

    const deviceStatus = statusResult.result as Array<{ code: string; value: unknown }>;
    const match = deviceStatus.find((item) => item.code === sceneId);
    if (match && match.value !== undefined) {
      const sceneValue = normalizeSceneData(match.value);
      const base = [[{ code: 'scene_data', value: sceneValue }]];
      if (!allowSwitch) {
        return base;
      }
      return base.concat([
        [
          { code: 'scene_data', value: sceneValue },
          { code: 'switch_led', value: switchOn }
        ]
      ]);
    }

    throw new Error(`Scene ${sceneId} not found in device status`);
  }

  if (directSceneData) {
    const sceneValue = normalizeSceneData(directSceneData);
    const base = [[{ code: 'scene_data', value: sceneValue }]];
    if (!allowSwitch) {
      return base;
    }
    return base.concat([
      [
        { code: 'scene_data', value: sceneValue },
        { code: 'switch_led', value: switchOn }
      ]
    ]);
  }

  throw new Error('Must provide sceneId or sceneData for scene mode');
}

async function trySendCommandSets(
  commandSets: Array<Array<{ code: string; value: any }>>,
  env: Env
): Promise<void> {
  let lastError: unknown;
  let lastCommands: Array<{ code: string; value: any }> | null = null;
  for (const commands of commandSets) {
    try {
      await sendCommand(commands, env, { logErrors: false });
      return;
    } catch (error) {
      lastError = error;
      lastCommands = commands;
    }
  }
  if (lastCommands) {
    console.error('Tuya API command payload on error:', JSON.stringify(lastCommands));
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Failed to send scene command');
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
      // Convert bitflag back to array of day numbers for frontend
      const daysOfWeekFlag = data?.daysOfWeek ?? 0;
      const daysOfWeek: number[] = [];
      for (let i = 0; i < 7; i++) {
        if ((daysOfWeekFlag & (1 << i)) !== 0) {
          daysOfWeek.push(i);
        }
      }
      return {
        name: key.name.replace('sequence:', ''),
        enabled: data?.enabled ?? false,
        startTime: data?.startTime || '',
        duration: data?.duration || 60,
        stepCount: data?.steps?.length || 0,
        daysOfWeek
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
  
  // Convert daysOfWeek array to bitflag
  let daysOfWeekFlag = 0;
  if (Array.isArray(body.daysOfWeek)) {
    daysOfWeekFlag = body.daysOfWeek.reduce((flag: number, day: number) => flag | (1 << day), 0);
  }
  
  const data = {
    enabled: body.enabled ?? false,
    startTime: body.startTime,
    duration: body.duration,
    steps: body.steps,
    daysOfWeek: daysOfWeekFlag
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
    try {
      const sceneValue = body.sceneValue ?? (body.sceneHue !== undefined ? { h: Number(body.sceneHue), s: 255, v: 255 } : undefined);
      console.log(`[scene mode] Activating scene: ${body.sceneId || '[direct data]'}`);
      const commandSets = await buildSceneCommandSets(
        {
          sceneId: body.sceneId,
          sceneData: body.sceneData,
          sceneValue,
          on: body.on,
          allowSwitch: true
        },
        c.env
      );
      console.log(`[scene mode] Attempting ${commandSets.length} command variants`);
      await trySendCommandSets(commandSets, c.env);
      return c.text('Bulb scene activated');
    } catch (error) {
      console.error('[scene mode] Error:', error);
      return c.json({ error: 'Failed to activate scene' }, 500);
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

// GET /bulb/status - Get full device status from Tuya
app.get('/bulb/status', sessionHandler, async (c) => {
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
    return c.json(result.result || []);
  } catch (error) {
    console.error('Error fetching status:', error);
    return c.json({ error: 'Failed to fetch status' }, 500);
  }
});

// GET /bulb/functions - Get device function definitions (supported commands)
app.get('/bulb/functions', sessionHandler, async (c) => {
  try {
    const accessToken = await getAccessToken(c.env);
    const path = `/v1.0/devices/${c.env.TUYA_DEVICE_ID}/functions`;
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
      throw new Error(`Failed to get device functions: ${result.msg}`);
    }
    return c.json(result.result || []);
  } catch (error) {
    console.error('Error fetching functions:', error);
    return c.json({ error: 'Failed to fetch functions' }, 500);
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
    const currentDayOfWeek = scheduledDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const dayFlag = 1 << currentDayOfWeek; // Convert day number to flag (1, 2, 4, 8, 16, 32, 64)
    
    // Process each sequence
    for (const key of list.keys) {
      const seqData = (await env.KV.get(key.name, 'json')) as {
        enabled?: boolean;
        daysOfWeek?: number;
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
      
      // Check if sequence runs on this day of week
      // If daysOfWeek is not specified or is 0, run on all days (backward compatibility)
      if (seqData.daysOfWeek && seqData.daysOfWeek > 0 && (seqData.daysOfWeek & dayFlag) === 0) {
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
        try {
          const sceneValue = step.sceneValue ?? (step.sceneHue !== undefined ? { h: Number(step.sceneHue), s: 255, v: 255 } : undefined);
          const commandSets = await buildSceneCommandSets(
            {
              sceneId: step.sceneId,
              sceneData: step.sceneData,
              sceneValue,
              on: step.on,
              allowSwitch: stepIdx === 0 || step.on === false
            },
            env
          );
          await trySendCommandSets(commandSets, env);
          commands = null;
        } catch (error) {
          console.error(`Scene step error:`, error);
          continue;
        }
        continue;
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