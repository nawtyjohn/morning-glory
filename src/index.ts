import { Hono } from 'hono';
import crypto from 'crypto';

declare global {
  // eslint-disable-next-line no-var
  var __MINIFLARE: boolean | undefined;
}

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

const app = new Hono();



app.post('/test-cron', async (c) => {
  // Restrict to local/dev only using Miniflare global
  if (!globalThis.__MINIFLARE) {
    return c.text('Forbidden: Only available in local/dev mode', 403);
  }
  if (typeof (c.env as Env).KV === 'undefined') {
    return c.text('KV not available');
  }
  // Simulate scheduled event
  await exports.scheduled({}, c.env as Env, {});
  return c.text('Scheduled handler invoked');
});

// Simple webapp for sequence input and visualization
app.get('/', (c) => {
  return c.html(`
    <html>
      <head>
        <title>Bulb Sequence Editor</title>
        <style>
          body { font-family: sans-serif; margin: 2em; }
          .color-preview { width: 40px; height: 40px; display: inline-block; border: 1px solid #ccc; margin-right: 8px; vertical-align: middle; }
        </style>
      </head>
      <body>
        <h2>Bulb Sequence Editor</h2>
        <form id="seqForm">
          <label>Paste Sequence JSON:<br>
            <textarea id="seqJson" rows="8" cols="60"></textarea>
          </label><br><br>
          <button type="button" onclick="parseSequence()">Parse & Visualize</button>
        </form>
        <div id="manualEntry">
          <h3>Manual Entry</h3>
          <button type="button" onclick="addStep()">Add Step</button>
          <div id="steps"></div>
        </div>
        <hr>
        <label>Start Time: <input type="time" id="startTime"></label>
        <label>Duration (minutes): <input type="number" id="duration" min="1" value="60"></label>
        <br><br>
        <button onclick="saveSequence()">Save Sequence to KV</button>
        <div id="result"></div>
        <script>
          let sequence = [];
          function parseSequence() {
            try {
              sequence = JSON.parse(document.getElementById('seqJson').value).steps || [];
              renderSteps();
            } catch (e) {
              alert('Invalid JSON');
            }
          }
          function addStep() {
            sequence.push({ work_mode: 'colour', hue: 0, saturation: 0, brightness: 0, on: true });
            renderSteps();
          }
          function renderSteps() {
            const stepsDiv = document.getElementById('steps');
            stepsDiv.innerHTML = '';
            sequence.forEach((step, i) => {
              let color = '#fff';
              if (step.work_mode === 'colour') {
                color = hsvToRgb(step.hue, step.saturation, step.brightness);
              }
              let html = '<div data-index="' + i + '">';
              html += '<span class="color-preview" style="background:' + color + '"></span>';
              html += 'Mode: <select class="mode-select" data-index="' + i + '">';
              html += '<option value="colour"' + (step.work_mode==='colour'?' selected':'') + '>Colour</option>';
              html += '<option value="white"' + (step.work_mode==='white'?' selected':'') + '>White</option>';
              html += '</select>';
              if (step.work_mode==='colour') {
                html += ' Hue: <input type="number" min="0" max="360" class="hue-input" data-index="' + i + '" value="' + step.hue + '">';
                html += ' Saturation: <input type="number" min="0" max="255" class="sat-input" data-index="' + i + '" value="' + step.saturation + '">';
                html += ' Brightness: <input type="number" min="0" max="255" class="bright-input" data-index="' + i + '" value="' + step.brightness + '">';
              } else {
                html += ' Brightness: <input type="number" min="0" max="255" class="bright-input" data-index="' + i + '" value="' + step.brightness + '">';
                html += ' Temperature: <input type="number" min="0" max="255" class="temp-input" data-index="' + i + '" value="' + (step.temperature||255) + '">';
              }
              html += ' On: <input type="checkbox" class="on-checkbox" data-index="' + i + '"' + (step.on?' checked':'') + '>';
              html += ' <button class="del-btn" data-index="' + i + '">Delete</button>';
              html += '</div>';
              stepsDiv.innerHTML += html;
            });
            // Add event listeners (event delegation)
            stepsDiv.querySelectorAll('.mode-select').forEach(el => {
              el.onchange = function() { updateStep(this.dataset.index, 'work_mode', this.value); };
            });
            stepsDiv.querySelectorAll('.hue-input').forEach(el => {
              el.onchange = function() { updateStep(this.dataset.index, 'hue', this.value); };
            });
            stepsDiv.querySelectorAll('.sat-input').forEach(el => {
              el.onchange = function() { updateStep(this.dataset.index, 'saturation', this.value); };
            });
            stepsDiv.querySelectorAll('.bright-input').forEach(el => {
              el.onchange = function() { updateStep(this.dataset.index, 'brightness', this.value); };
            });
            stepsDiv.querySelectorAll('.temp-input').forEach(el => {
              el.onchange = function() { updateStep(this.dataset.index, 'temperature', this.value); };
            });
            stepsDiv.querySelectorAll('.on-checkbox').forEach(el => {
              el.onchange = function() { updateStep(this.dataset.index, 'on', this.checked); };
            });
            stepsDiv.querySelectorAll('.del-btn').forEach(el => {
              el.onclick = function() { removeStep(this.dataset.index); };
            });
          }
          function updateStep(i, key, value) {
            if (key === 'on') value = value ? true : false;
            else value = key === 'work_mode' ? value : Number(value);
            sequence[i][key] = value;
            renderSteps();
          }
          function removeStep(i) {
            sequence.splice(i,1);
            renderSteps();
          }
          function hsvToRgb(h,s,v) {
            s /= 255; v /= 255;
            let c = v * s, x = c * (1 - Math.abs((h/60)%2-1)), m = v-c;
            let r=0,g=0,b=0;
            if (h<60) {r=c;g=x;} else if (h<120) {r=x;g=c;} else if (h<180) {g=c;b=x;} else if (h<240) {g=x;b=c;} else if (h<300) {r=x;b=c;} else {r=c; b=x;}
            r=Math.round((r+m)*255);g=Math.round((g+m)*255);b=Math.round((b+m)*255);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
          }
          async function saveSequence() {
            const startTime = document.getElementById('startTime').value;
            const duration = Number(document.getElementById('duration').value);
            const payload = {
              steps: sequence,
              startTime,
              duration
            };
            const res = await fetch('/save-sequence', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify(payload)
            });
            document.getElementById('result').innerText = await res.text();
          }
        </script>
      </body>
    </html>
  `);
});

// Save sequence to KV
app.post('/save-sequence', async (c) => {
  const body = await c.req.json();
  const key = `sequence:${Date.now()}`;
  await (c.env as Env).KV.put(key, JSON.stringify(body));
  return c.text(`Saved as ${key}`);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("Scheduled event triggered at", new Date().toISOString());
    // Assume only one active sequence for simplicity
    // Key format: sequence:<timestamp>
    const keys = await env.KV.list({ prefix: 'sequence:' });
    if (!keys.keys.length) return;
    // Use the latest sequence
    const key = keys.keys[keys.keys.length - 1].name;
    const seqData = (await env.KV.get(key, 'json')) as {
      steps: Array<any>;
      startTime: string;
      duration: number;
    } | null;
    if (!seqData || !seqData.steps || !seqData.startTime || !seqData.duration) return;

    // Calculate which step to play
    const now = new Date();
    // Parse start time as today in UTC
    const [h, m] = seqData.startTime.split(':').map(Number);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0, 0));
    const durationMs = seqData.duration * 60 * 1000;
    const end = new Date(start.getTime() + durationMs);
    if (now < start || now > end) return; // Not in window

    // Which step?
    const stepCount = seqData.steps.length;
    const elapsedMs = now.getTime() - start.getTime();
    const stepIdx = Math.floor(elapsedMs / (durationMs / stepCount));
    if (stepIdx < 0 || stepIdx >= stepCount) return;
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
      await sendCommand(commands);
      console.log(`Played step ${stepIdx + 1}/${stepCount} at ${now.toISOString()}`);
    } catch (error) {
      console.error('Error sending command:', error);
    }
  },
} satisfies ExportedHandler<Env>;