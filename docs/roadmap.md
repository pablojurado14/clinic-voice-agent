# Roadmap

Four weeks, one deliverable each. A week is done when its "done when" line is true, not when the code exists.

## Week 1 (1-7 Oct): first call

- Backend deployed at a public HTTPS URL.
- Voice agent configured with the prompt, both languages and the four tools.
- **Done when:** a call from the browser asks for a day, hears the open gaps, picks one, and that gap
  is gone on the next call. Once in Spanish, once in English.

## Week 2 (8-14 Oct): hard cases and reception hand-off

- Spoken dates ("el martes que viene", "next Tuesday").
- Patient not found; several patients on one phone.
- Day with no gaps; treatment that fits nowhere.
- Call cut half-way.
- Two calls for the same slot.
- Offers that expire: `book` accepts any `option_id` from `offers` forever, including one
  whose time has already passed. The exclusion constraint does not catch it, because a slot in
  the past overlaps nothing. Decide the lifetime and where it is enforced.
- Pain or urgency.
- Tool or database failure.
- **Done when:** ten written cases pass when tried by hand, and each one has an expected outcome
  written down before it is tried.

## Week 3 (15-21 Oct): reception console

- The day's agenda with gaps filling in.
- Calls with transcript, outcome and why those options were offered.
- Callback queue for the next morning.
- Undo a booking.
- Spanish and English.
- **Done when:** someone who has not seen the project understands in one minute what happened last night.

## Week 4 (22-28 Oct): simulated callers and evals

- 50 simulated callers covering the hard cases, in both languages.
- Pass rate per case type.
- A log of every failure and the change it led to.
- Voice and latency tuning.
- *Optional:* expose the four tools as an MCP server, so their definitions live in this repo and are
  versioned with the code instead of being retyped into the voice platform's dashboard. Today the name,
  path, parameters and description of each tool exist twice: in `src/lib/tools.ts` and in
  `docs/voice-agent-setup.md`, copied by hand into the panel. The two can drift without anything
  failing loudly. Depends on the platform supporting MCP for agents; check before committing to it.
  Cut this first if week 4 runs late: the evals are the deliverable, this is plumbing.
- **Done when:** the pass rate is measured, and every remaining failure is listed with its cause.

## Wrap-up (29-31 Oct)

- Three-minute video.
- Two-page mission report: what was asked, what was built, what was measured, what would change with a real clinic.
- README brought up to date.

## If it runs late

Cut the console down to a plain table and the simulated callers to 25. Hard cases and evals stay.
