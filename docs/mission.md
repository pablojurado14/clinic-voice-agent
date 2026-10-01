# Mission brief

**Client (fictional):** Clínica Dental Alameda, two dentists, reception open on weekdays.

**Problem.** Calls that arrive after reception closes go to voicemail. Some of those callers wanted an
appointment, and the agenda still has open gaps that nobody offered them.

**Mission.** An agent that answers after hours, offers the open gaps for the day the patient asks for,
and books the one the patient picks. Anything it cannot resolve is written down for reception to call
back the next working day.

**Rules the clinic set**

- A slot that has been given is gone. No double booking, ever.
- If the agent cannot tell whether there is availability, it does not improvise: it takes a message.
- If the requested day is full, it asks once for another day, then hands over to reception.
- It reads out three options at most.
- It serves callers in Spanish and in English.

**How success will be measured** (definitions only; no figures until there are simulated or real calls)

- Share of after-hours calls resolved without reception.
- Share of open gaps filled by the agent.
- Callbacks left for reception, and how many were urgent.
- Wrong outcomes: a time offered that did not exist, a booking confirmed that was not stored.
  The target for both is zero.

**Out of scope for now**

- Changing or cancelling existing appointments.
- Prices, quotes, insurance.
- Messaging channels. Voice only.
- Languages other than Spanish and English.
- Integration with a real practice-management system. The agenda lives in this project's database.

**Assumptions to validate with a real clinic**

- Treatment list and durations.
- Opening hours, minimum notice for same-day bookings (60 minutes) and the shortest sellable gap (30 minutes).
- The wording of the emergency hand-off in the agent prompt, which a dentist should review.
