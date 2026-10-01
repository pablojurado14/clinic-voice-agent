# CLAUDE.md

Rules for working in this repository. Read them before changing anything.

## What this is

A bilingual (Spanish and English) voice agent that answers a dental clinic's phone after hours, offers
the open gaps for the day the patient asks for, and books the one they choose. What it cannot resolve
becomes a callback for reception. All data is synthetic.

The voice layer runs on an external platform. This repo is the backend it calls: four HTTP tools, a
deterministic slot engine and a Postgres database.

## Commands

```bash
npm run db:setup   # recreate schema + synthetic two-week agenda (destructive)
npm test           # engine unit tests, no database needed
npm run test:db    # end-to-end check of the four tools against the database
npm run build      # type-check and build
npm run dev
```

## Map

- `src/lib/slots.ts` — the engine. Pure functions: no database, no network, no AI.
- `src/lib/tools.ts` — the four tools: `find_patient`, `get_options`, `book`, `note_for_reception`.
- `src/lib/route.ts` — shared endpoint wrapper: secret check, event log, safe fallback.
- `src/lib/time.ts` — Europe/Madrid dates and spoken labels in both languages.
- `src/lib/config.ts` — clinic settings (horizon, minimum notice, shortest sellable gap, max options).
- `db/schema.sql`, `db/setup.ts`, `db/smoke.ts` — schema, seed, end-to-end check.
- `agent/prompt.md`, `docs/voice-agent-setup.md` — what is pasted into the voice platform.
- `docs/roadmap.md` — weekly plan with a "done when" line per week. `docs/deploy.md` — how to put it online.
- `docs/mission.md` — what the clinic asked for and how success is measured.

## Invariants

These are the design. Do not weaken them to make something else easier. If a task seems to need it,
stop and say so.

1. **The engine decides what is offered.** Which times are offered and in what order is decided in
   `slots.ts`, never by the language model and never in the prompt.
2. **The agent only books what the engine offered.** `book` accepts an `option_id` stored in `offers`
   during the same call, nothing else. Never add a way to book a free-form date or time.
3. **The database prevents double booking.** The exclusion constraint on `appointments` stays. Do not
   replace it with a check in application code.
4. **The model does no date maths.** Dates come from the calendar returned by `find_patient`.
5. **The model translates nothing.** Anything spoken (days, times, doctors, treatments) is returned by
   the backend already in the call's language. `instruction` fields are for the model and stay in English.
6. **Every failure has an instruction.** Tools return `ok: false` with a `reason` and an `instruction`.
   An unexpected error becomes "take a message for reception", never a guess, and the endpoint still
   answers HTTP 200.
7. **Every tool call is logged** in `tool_events`.
8. **Synthetic data only.** No real patient, clinic or phone data in code, seeds, tests, logs or docs.

## How to work here

- Reply to the owner in Spanish (Spain). Code, comments, commit messages and docs stay in English.
- Small commits, one change each, with a message that says what changed and why.
- `npm test`, `npm run test:db` and `npm run build` pass before every commit.
- A change to an engine rule comes with a test in `slots.test.ts` that would fail without it.
- A new tool behaviour comes with a check in `db/smoke.ts`.
- Anything the caller can hear must exist in Spanish and English. Add both or neither.
- Do not add dependencies, services or tables without asking first.
- Do not widen the scope on your own. Propose it, clearly marked as a proposal, and wait for a decision.
- Do not invent figures, results or metrics in docs. If a number has not been measured, leave it out.
- Secrets live in `.env.local`, which is never committed.
- Keep the code readable enough to be explained line by line: plain functions, clear names, comments
  that say why. No clever abstractions.
- After any change, explain in a few lines what you changed and why, so the owner can defend it.
- When the owner says he is doing an exercise himself, guide and review. Do not write the code for him.

## Scope

The plan and its order are in `docs/roadmap.md`. Work on the current week only.

In scope now: the first working call in both languages, then hard cases (spoken dates, unknown or
ambiguous patient, full day, treatment that does not fit, cut calls, two calls for one slot, pain or
urgency, tool failure).

Later, in this order: reception console (agenda, calls, callback queue, undo; bilingual), simulated
callers and evals, final write-up.

Out of scope unless the owner says otherwise: messaging channels, changing or cancelling existing
appointments, prices, a real practice-management integration, languages other than Spanish and English.
