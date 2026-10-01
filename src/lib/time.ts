// Date helpers. Everything the clinic sees is in Europe/Madrid time.
// Dates travel as 'YYYY-MM-DD' strings; instants travel as epoch milliseconds.
// Every spoken label exists in Spanish and English.

export const CLINIC_TZ = 'Europe/Madrid';

export type Lang = 'es' | 'en';
const LOCALE: Record<Lang, string> = { es: 'es-ES', en: 'en-GB' };

/** Anything that is not clearly English is treated as Spanish, the clinic's main language. */
export function toLang(value: unknown): Lang {
  return String(value ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Today's date in Madrid as 'YYYY-MM-DD'. */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ }).format(now);
}

/** Adds n calendar days to a 'YYYY-MM-DD' date. */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`); // noon UTC avoids any DST edge
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 'lunes 5 de octubre' / 'Monday 5 October' */
export function dayLabel(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${isoDate}T12:00:00Z`))
    .replace(',', '');
}

/** Madrid time for a given instant: '17:30' in Spanish, '5:30 pm' in English. */
export function timeLabel(epochMs: number, lang: Lang): string {
  const options: Intl.DateTimeFormatOptions =
    lang === 'en'
      ? { timeZone: CLINIC_TZ, hour: 'numeric', minute: '2-digit', hour12: true }
      : { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hour12: false };
  return new Intl.DateTimeFormat(LOCALE[lang], options).format(new Date(epochMs)).replace(/\u202f|\u00a0/g, ' ');
}

export type CalendarDay = { date: string; label: string };

const WORDS = {
  es: { today: 'hoy, ', tomorrow: 'mañana, ', on: 'el ' },
  en: { today: 'today, ', tomorrow: 'tomorrow, ', on: 'on ' },
} as const;

/**
 * The next `days` days starting today, with spoken labels.
 * The agent maps "el martes que viene" or "next Tuesday" onto this list instead of doing
 * date maths, which is where language models get weekdays wrong.
 */
export function calendar(days: number, lang: Lang, now: Date = new Date()): CalendarDay[] {
  const today = madridToday(now);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const prefix = i === 0 ? WORDS[lang].today : i === 1 ? WORDS[lang].tomorrow : '';
    return { date, label: `${prefix}${dayLabel(date, lang)}` };
  });
}

/** Next working day (Mon-Fri) after today, as a spoken label. Public holidays are out of scope. */
export function nextWorkingDayLabel(lang: Lang, now: Date = new Date()): string {
  const tomorrow = addDays(madridToday(now), 1);
  let date = tomorrow;
  while (isoWeekday(date) > 5) date = addDays(date, 1);
  return date === tomorrow ? `${WORDS[lang].tomorrow}${dayLabel(date, lang)}` : `${WORDS[lang].on}${dayLabel(date, lang)}`;
}
