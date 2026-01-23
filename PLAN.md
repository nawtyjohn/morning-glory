# Smart Bulb Sequence Recorder & Replayer – Project Plan

## Overview

Build a system to:
- Record a sequence of smart bulb states via a CLI.
- Store the sequence for later use.
- Replay the sequence on a schedule using a Cloudflare Worker, gradually changing the bulb’s state (e.g., for a sunrise alarm).

---

## Components

### 1. CLI Recorder (TypeScript)
- Capture bulb state (on/off, brightness, color, etc.) on keypress.
- Store each state with a timestamp or interval.
- Stop recording on another keypress.
- Save the sequence as JSON.

### 2. Sequence Storage
- Upload the JSON sequence to Cloudflare KV (Key-Value storage).

### 3. Cloudflare Worker (TypeScript)
- Expose API to:
  - Upload a new sequence.
  - Schedule a replay (start time, interval override).
- Store replay jobs and sequences in KV.
- Use cron triggers to:
  - Check for scheduled jobs.
  - Determine which command in the sequence to run.
  - Send the command to the bulb (via HTTP or other protocol).

### 4. Sequence Replay Logic
- Calculate which command to run based on:
  - Start time.
  - Replay interval.
  - Current time (from cron trigger).
- Mark progress in KV to ensure correct sequence step is executed.

---

## Example Workflow

1. User records a sequence using the CLI.
2. User uploads the sequence to the Worker via API.
3. User schedules a replay (e.g., 7:00 AM, 1-minute interval).
4. Worker cron job runs every minute:
   - Checks for scheduled jobs.
   - Determines which step to run.
   - Sends command to bulb.
   - Updates progress in KV.
5. Sequence completes; Worker marks job as done.

---

## Next Steps

- Define the bulb state data structure.
- Implement CLI recorder.
- Set up Cloudflare Worker with KV and cron.
- Implement API endpoints and replay logic.
