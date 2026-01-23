# Local Cron Trigger Testing Examples

Below are clickable links to test your 7-step sequence scheduled from **07:00 UTC** for **35 minutes**. Each step lasts 5 minutes. For each step, there is a link for just before and just after the step should trigger.

Replace `localhost:8787` with your actual dev server address/port if different.

---

## Step timing (7 steps, 35 minutes)
- Start: 07:00 UTC
- Duration: 35 minutes
- Step length: 5 minutes

## Test links for each step

| Step | Before (UTC) | After (UTC) |
|------|--------------|-------------|
| 1    | 06:59:59     | 07:00:01    |
| 2    | 07:04:59     | 07:05:01    |
| 3    | 07:09:59     | 07:10:01    |
| 4    | 07:14:59     | 07:15:01    |
| 5    | 07:19:59     | 07:20:01    |
| 6    | 07:24:59     | 07:25:01    |
| 7    | 07:29:59     | 07:30:01    |

### Clickable test links

| Step | Before | After |
|------|--------|-------|
| 1 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745855999) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856001) |
| 2 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856299) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856301) |
| 3 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856599) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856601) |
| 4 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856899) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856901) |
| 5 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745857199) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745857201) |
| 6 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745857499) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745857501) |
| 7 | [Before](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745857799) | [After](http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745857801) |

---

## How to use
- Click the "Before" link to test just before a step should trigger (should not play).
- Click the "After" link to test just after a step should trigger (should play that step).
- Watch your Worker logs and bulb for results.

---

For more info, see [Cloudflare Cron Triggers Docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
