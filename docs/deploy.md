# Deploying

The voice platform calls the tools over the internet, so the backend needs a public HTTPS URL.
Any host works. What it needs:

- Node 22 or later.
- A Postgres database where the `btree_gist` extension can be enabled. Use a database of its own for
  this project.
- HTTPS in front of the app (a managed platform gives it to you; on a server, a reverse proxy with a
  certificate).

## Environment variables

| Name | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `TOOL_SECRET` | Long random string. The voice platform sends it in the `x-tool-secret` header. |

Locally they live in `.env.local`, which is never committed. On the host, set them as environment variables.

## Steps

```bash
npm ci
npm run db:setup     # creates the schema and the synthetic agenda (destructive: it resets everything)
npm run build
npm start            # listens on port 3000; set PORT to change it
```

## Check it from outside

Replace the URL and the secret:

```bash
# Without the secret: must answer 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://YOUR-DEPLOYMENT/api/tools/find-patient \
  -H "content-type: application/json" -d '{}'

# With the secret: must answer ok: true with a patient, treatments and a calendar
curl -s -X POST https://YOUR-DEPLOYMENT/api/tools/find-patient \
  -H "content-type: application/json" -H "x-tool-secret: YOUR-SECRET" \
  -d '{"phone":"600000002","language":"es"}'
```

A third check, on the host and not on your laptop: spoken times are formatted by the host's ICU,
whose version decides whether `5:30 pm` carries a normal space or a narrow no-break space (U+202F)
between the minutes and `pm`. The character is invisible in logs and in `tool_events`, and nothing in
the agent would notice, but the voice platform would read the string as given. `src/lib/time.ts`
normalises it; this confirms the deployed host agrees. Use a weekday within the horizon:

```bash
curl -s -X POST https://YOUR-DEPLOYMENT/api/tools/get-options \
  -H "content-type: application/json" -H "x-tool-secret: YOUR-SECRET" \
  -d '{"conversation_id":"deploy-check","date":"YYYY-MM-DD","treatment":"checkup","language":"en"}' \
  | python3 -c "import json,sys; t=json.load(sys.stdin)['options'][0]['time']; print(repr(t), [hex(ord(c)) for c in t])"
```

Every code point must be ASCII: the space is `0x20`. Anything else (`0x202f`, `0xa0`) means the host
formats differently from the development machine, and English times need listening to before a demo.

If all three answer as expected, continue with `docs/voice-agent-setup.md`.

## Keeping the demo alive

The agenda covers 14 days from the day `npm run db:setup` runs. Run it again when the demo gets stale
or after a round of test calls.
