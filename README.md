# After-hours booking agent for a dental clinic

A bilingual voice agent (Spanish and English) that answers the phone when reception is closed, offers
the open gaps for the day the patient wants, and books the one they choose. Anything it cannot resolve
becomes a callback for reception the next working day.

All data is synthetic: the clinic, the doctors, the patients and the agenda are invented.

## How a call works

1. The agent asks for name and phone and looks the patient up (`find_patient`).
2. It asks for the reason of the visit and the day.
3. The backend computes the open gaps for that day and treatment and returns up to three (`get_options`).
4. The patient picks one and the agent books it (`book`).
5. If anything is unclear or fails, the agent takes a message (`note_for_reception`).

## Design decisions

- **The engine decides what is offered, not the language model.** `src/lib/slots.ts` is plain,
  deterministic code with no database and no AI. It places appointments at the edges of free gaps and
  prefers placements that leave no unusable minutes behind.
- **The agent can only book what the engine offered.** Each option is stored with an id, and `book`
  accepts nothing but an id issued in the same call. A made-up time cannot be booked.
- **Double booking is impossible at the database level.** An exclusion constraint on `appointments`
  rejects overlapping confirmed appointments for the same doctor, so two simultaneous calls cannot both
  win the same slot.
- **The model never does date maths.** `find_patient` returns a calendar of the next 14 days with spoken
  labels; the agent maps "next Tuesday" or "el martes que viene" onto that list.
- **The backend speaks both languages, the model translates nothing.** Each tool takes a `language`
  parameter and returns days, times, doctors and treatments already in Spanish or English. Reception
  sees which language each booking and callback was in.
- **Every failure has an instruction.** Tools answer `ok: false` with a reason and what to do next.
  A crash becomes "take a message for reception", never a guess.
- **Every tool call is logged** with input, output and latency in `tool_events`.

## Run it locally

Requires Node 22+ and a Postgres database (the `btree_gist` extension must be available).

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL and TOOL_SECRET
npm run db:setup               # creates the schema and a synthetic two-week agenda
npm test                       # engine unit tests
npm run test:db                # end-to-end check of the four tools against the database
npm run dev
```

`npm run db:setup` can be re-run at any time to reset the demo. The agenda covers 14 days from the day
you run it, so re-run it when the demo gets stale.

To put it online, see `docs/deploy.md`. To connect the voice agent, see `docs/voice-agent-setup.md`.
The agent prompt is in `agent/prompt.md`. The plan is in `docs/roadmap.md`.

## Layout

```
agent/prompt.md            first messages (Spanish, English) and system prompt
db/schema.sql              tables and the no-double-booking constraint
db/setup.ts                schema + synthetic agenda
db/smoke.ts                end-to-end check against a real database
docs/mission.md            what the clinic asked for and how success is measured
docs/roadmap.md            weekly plan with a "done when" line per week
docs/deploy.md             how to put the backend online
docs/voice-agent-setup.md  tool definitions for the voice platform
src/lib/slots.ts           the engine (pure functions) and slots.test.ts
src/lib/tools.ts           the four tools
src/lib/route.ts           auth, logging and safe fallback shared by the endpoints
src/app/api/tools/*        one endpoint per tool
```

## Status

Built: data model, synthetic agenda, engine, the four tools in Spanish and English, agent prompt.

Not built yet: hard cases (cut calls, rescheduling requests, noisy input), the reception console
(also bilingual), simulated callers and evals.
