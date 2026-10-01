import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeGaps, rankOptions, type DoctorInterval } from './slots';

// Helper: minutes after 09:00 on an arbitrary day, as epoch ms.
const BASE = Date.UTC(2026, 9, 5, 7, 0); // 09:00 Madrid (UTC+2) on Mon 5 Oct 2026
const at = (min: number) => BASE + min * 60_000;
const hhmm = (ms: number) => {
  const m = (ms - BASE) / 60_000 + 9 * 60;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const settings = { minUsefulMin: 30, notBefore: 0, max: 3 };
const session = (doctorId: number, from: number, to: number): DoctorInterval => ({ doctorId, start: at(from), end: at(to) });
const appt = session;

test('freeGaps: session minus appointments', () => {
  const gaps = freeGaps({ start: at(0), end: at(300) }, [
    { start: at(0), end: at(60) },
    { start: at(90), end: at(300) },
  ]);
  assert.deepEqual(gaps.map((g) => [hhmm(g.start), hhmm(g.end)]), [['10:00', '10:30']]);
});

test('a fully booked day returns no options', () => {
  const options = rankOptions([session(1, 0, 300)], [appt(1, 0, 300)], 30, settings);
  assert.equal(options.length, 0);
});

test('a treatment that does not fit in any gap is never offered', () => {
  // Only a 45-minute gap; endodontics needs 90.
  const options = rankOptions([session(1, 0, 300)], [appt(1, 0, 100), appt(1, 145, 300)], 90, settings);
  assert.equal(options.length, 0);
});

test('exact fits come before placements that leave dead minutes', () => {
  // Gap A 10:00-10:45 (45 min) and gap B 12:00-12:30 (30 min). Treatment: 30 min.
  // A would leave 15 dead minutes; B fits exactly.
  const busy = [appt(1, 0, 60), appt(1, 105, 180), appt(1, 210, 300)];
  const options = rankOptions([session(1, 0, 300)], busy, 30, { ...settings, max: 1 });
  assert.equal(hhmm(options[0].start), '12:00');
  assert.equal(options[0].reason, 'exact_fit');
});

test('inside a large gap, only the edges are offered, never the middle', () => {
  // Gap 10:00-12:00, treatment 30 min -> 10:00 and 11:30.
  const busy = [appt(1, 0, 60), appt(1, 180, 300)];
  const options = rankOptions([session(1, 0, 300)], busy, 30, settings);
  assert.deepEqual(options.map((o) => hhmm(o.start)), ['10:00', '11:30']);
});

test('options are spread across gaps before using both edges of one gap', () => {
  // Three large gaps; max 3 -> one option from each gap.
  const busy = [appt(1, 60, 90), appt(1, 150, 180), appt(1, 240, 300)];
  const options = rankOptions([session(1, 0, 300)], busy, 30, settings);
  assert.deepEqual(options.map((o) => hhmm(o.start)), ['09:00', '10:30', '12:00']);
});

test('the same time with two doctors is said only once', () => {
  const busy = [appt(1, 30, 300), appt(2, 30, 300)];
  const options = rankOptions([session(1, 0, 300), session(2, 0, 300)], busy, 30, settings);
  assert.equal(options.length, 1);
});

test('never returns more than max, and always in chronological order', () => {
  const options = rankOptions([session(1, 0, 300), session(2, 0, 300)], [appt(1, 120, 150), appt(2, 45, 60)], 30, settings);
  assert.equal(options.length, 3);
  assert.deepEqual([...options].sort((a, b) => a.start - b.start), options);
});

test('same-day calls: nothing before notBefore, rounded up to the quarter hour', () => {
  // Free all morning; it is 10:20 -> first option 10:30.
  const options = rankOptions([session(1, 0, 300)], [], 30, { ...settings, notBefore: at(80) });
  assert.equal(hhmm(options[0].start), '10:30');
  assert.ok(options.every((o) => o.start >= at(80)));
});

test('no option ever overlaps an existing appointment or leaves the session', () => {
  const sessions = [session(1, 0, 300), session(2, 0, 300)];
  const busy = [appt(1, 0, 45), appt(1, 75, 165), appt(1, 210, 300), appt(2, 30, 120), appt(2, 165, 255)];
  for (const duration of [30, 45, 90]) {
    for (const o of rankOptions(sessions, busy, duration, { ...settings, max: 10 })) {
      const s = sessions.find((x) => x.doctorId === o.doctorId)!;
      assert.ok(o.start >= s.start && o.end <= s.end);
      assert.ok(busy.filter((b) => b.doctorId === o.doctorId).every((b) => o.end <= b.start || o.start >= b.end));
    }
  }
});

test('a gap with unsellable leftover gives one option, not two overlapping ones', () => {
  // Gap 13:00-14:00 (60 min), treatment 45 min -> only 13:00 (13:15 would be the same choice).
  const options = rankOptions([session(1, 0, 300)], [appt(1, 0, 240)], 45, settings);
  assert.deepEqual(options.map((o) => hhmm(o.start)), ['13:00']);
  assert.equal(options[0].reason, 'leaves_dead_minutes');
});
