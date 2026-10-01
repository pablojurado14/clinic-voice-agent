// The deterministic engine. No database, no AI: given a doctor's working hours and
// existing appointments for one day, decide which start times to offer.
//
// Rule of thumb: place the new appointment at the edge of a free gap, never in the
// middle, and prefer placements that do not leave unusable minutes behind.

export type Interval = { start: number; end: number }; // epoch milliseconds
export type DoctorInterval = Interval & { doctorId: number };

export type OptionReason = 'exact_fit' | 'leaves_usable_gap' | 'leaves_dead_minutes';

export type Option = {
  doctorId: number;
  start: number;
  end: number;
  /** Minutes left in the gap after booking that are too short to sell (below minUsefulMin). */
  deadMinutes: number;
  /** Minutes left in the gap after booking, usable or not. */
  leftoverMinutes: number;
  reason: OptionReason;
};

export type RankSettings = {
  /** Shortest appointment the clinic sells. A leftover below this is dead time. */
  minUsefulMin: number;
  /** Do not offer anything starting before this instant (e.g. now + minimum notice). */
  notBefore: number;
  /** How many options to return. By phone, nobody retains more than three. */
  max: number;
};

const MIN = 60_000;
const QUARTER = 15 * MIN;

/** Working session minus appointments = free gaps, in chronological order. */
export function freeGaps(session: Interval, busy: Interval[]): Interval[] {
  const sorted = busy
    .filter((b) => b.end > session.start && b.start < session.end)
    .sort((a, b) => a.start - b.start);

  const gaps: Interval[] = [];
  let cursor = session.start;
  for (const b of sorted) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < session.end) gaps.push({ start: cursor, end: session.end });
  return gaps;
}

/** Candidate placements inside one gap: flush with its start and, if the gap is large, flush with its end. */
function placementsInGap(gap: DoctorInterval, durationMin: number, settings: RankSettings): Option[] {
  // If the gap has already started (same-day calls), begin at the next quarter of an hour.
  const earliest = gap.start >= settings.notBefore ? gap.start : Math.ceil(settings.notBefore / QUARTER) * QUARTER;
  const usableMin = Math.floor((gap.end - earliest) / MIN);
  if (usableMin < durationMin) return [];

  const leftoverMinutes = usableMin - durationMin;
  const deadMinutes = leftoverMinutes > 0 && leftoverMinutes < settings.minUsefulMin ? leftoverMinutes : 0;
  const reason: OptionReason =
    leftoverMinutes === 0 ? 'exact_fit' : deadMinutes > 0 ? 'leaves_dead_minutes' : 'leaves_usable_gap';

  const make = (start: number): Option => ({
    doctorId: gap.doctorId,
    start,
    end: start + durationMin * MIN,
    deadMinutes,
    leftoverMinutes,
    reason,
  });

  const atStart = make(earliest);
  // A second placement, flush with the end of the gap, only makes sense when what is left
  // over is still sellable. Otherwise both placements are the same choice 15 minutes apart.
  if (leftoverMinutes < settings.minUsefulMin) return [atStart];
  return [atStart, make(gap.end - durationMin * MIN)];
}

/** Lower is better: no dead minutes first, then exact fits, then the earliest time. */
function compare(a: Option, b: Option): number {
  return (
    a.deadMinutes - b.deadMinutes ||
    Number(a.reason !== 'exact_fit') - Number(b.reason !== 'exact_fit') ||
    a.start - b.start ||
    a.doctorId - b.doctorId
  );
}

/**
 * Best options for one day and one treatment duration.
 * Takes the best placement of each gap first (so options are spread across the day),
 * then second placements if there is room. Returned in chronological order.
 */
export function rankOptions(
  sessions: DoctorInterval[],
  busy: DoctorInterval[],
  durationMin: number,
  settings: RankSettings,
): Option[] {
  const primary: Option[] = [];
  const secondary: Option[] = [];

  for (const session of sessions) {
    const doctorBusy = busy.filter((b) => b.doctorId === session.doctorId);
    for (const gap of freeGaps(session, doctorBusy)) {
      const [first, second] = placementsInGap({ ...gap, doctorId: session.doctorId }, durationMin, settings);
      if (first) primary.push(first);
      if (second) secondary.push(second);
    }
  }

  const chosen: Option[] = [];
  const takenStarts = new Set<number>();
  for (const pool of [primary.sort(compare), secondary.sort(compare)]) {
    for (const option of pool) {
      if (chosen.length >= settings.max) break;
      if (takenStarts.has(option.start)) continue; // same time with two doctors: say it once
      takenStarts.add(option.start);
      chosen.push(option);
    }
  }

  return chosen.sort((a, b) => a.start - b.start);
}
