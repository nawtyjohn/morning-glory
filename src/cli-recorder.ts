
const readline = require('readline');
const fs = require('fs');
const path = require('path');
import type { BulbStateSequence, BulbStateSequenceItem } from './bulb-types';

const BULB_STATUS_URL = 'http://localhost:8787/status'; // Change if worker runs elsewhere

async function getBulbStatus(): Promise<any> {
  const res = await fetch(BULB_STATUS_URL);
  if (!res.ok) throw new Error('Failed to fetch bulb status');
  const data = await res.json();
  // Tuya API returns status as an array of {code, value}
  // Map to BulbState
  const state: any = {};
  const result = (data as any).result;
  for (const item of result) {
    if (item.code === 'switch_led') state.on = item.value;
    if (item.code === 'bright_value') state.brightness = item.value;
    if (item.code === 'colour_data') state.color = item.value;
    if (item.code === 'temp_value') state.temperature = item.value;
  }
  return state;
}

async function main() {
  const sequence: BulbStateSequenceItem[] = [];
  let startTime = Date.now();
  console.log('--- Bulb Sequence Recorder ---');
  console.log('Instructions:');
  console.log('  Press ENTER to record the current bulb state.');
  console.log('  Type q and press ENTER to stop and save the sequence.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Record (ENTER) or quit (q + ENTER): '
  });

  rl.prompt();
  rl.on('line', async (input: string) => {
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
    const seq: BulbStateSequence = {
      steps: sequence,
      recordedAt: new Date().toISOString(),
    };
    const outPath = path.join(process.cwd(), `bulb-sequence-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(seq, null, 2));
    console.log('Sequence saved to', outPath);
    process.exit(0);
  });
  const seq: BulbStateSequence = {
    steps: sequence,
    recordedAt: new Date().toISOString(),
  };
  const outPath = path.join(process.cwd(), `bulb-sequence-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(seq, null, 2));
  console.log('Sequence saved to', outPath);
  process.exit(0);
}

main().catch(console.error);
