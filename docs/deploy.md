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

If both answer as expected, continue with `docs/voice-agent-setup.md`.

## Keeping the demo alive

The agenda covers 14 days from the day `npm run db:setup` runs. Run it again when the demo gets stale
or after a round of test calls.
