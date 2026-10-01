// The four tools the voice agent can call. Each one takes plain input, talks to the
// database and returns a small JSON object the agent can act on.
//
// Two conventions:
// - Every failure comes back with `ok: false`, a machine-readable `reason` and an `instruction`
//   telling the agent what to do next. Instructions are written for the model, in English,
//   and are never read out loud.
// - Everything meant to be spoken (days, times, doctors, treatments) comes back already in the
//   caller's language, chosen by the `language` parameter ('es' or 'en').

import type postgres from 'postgres';
import { HORIZON_DAYS, MAX_OPTIONS, MIN_NOTICE_MIN, MIN_USEFUL_MIN } from './config';
import { rankOptions, type DoctorInterval } from './slots';
import { addDays, calendar, dayLabel, isValidIsoDate, madridToday, nextWorkingDayLabel, timeLabel, toLang, type Lang } from './time';

type Sql = postgres.Sql;

export type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; reason: string; instruction: string };

const TO_RECEPTION =
  'Do not confirm any appointment. Collect name, phone, reason for the visit and preferred days or times, call note_for_reception, and tell the caller that reception will call back.';

/** Keeps digits only and drops the Spanish country prefix: '+34 600 00 00 01' -> '600000001'. */
export function normalizePhone(raw: unknown): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('0034')) digits = digits.slice(4);
  else if (digits.startsWith('34') && digits.length === 11) digits = digits.slice(2);
  return digits;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Picks the column for the caller's language. Only ever 'name_es' or 'name_en'. */
const nameColumn = (sql: Sql, lang: Lang) => sql(lang === 'en' ? 'name_en' : 'name_es');

// ---------------------------------------------------------------------------------------
// 1. find_patient
// ---------------------------------------------------------------------------------------

export async function findPatient(sql: Sql, input: { name?: string; phone?: string; language?: string }): Promise<ToolResult> {
  const lang = toLang(input.language);
  const phone = normalizePhone(input.phone);
  const name = String(input.name ?? '').trim();

  if (phone.length !== 9) {
    return { ok: false, reason: 'invalid_phone', instruction: 'Ask for the phone number again, digit by digit, then call find_patient again.' };
  }

  const matches = await sql<{ id: number; name: string }[]>`SELECT id, name FROM patients WHERE phone = ${phone} ORDER BY id`;
  let patient: { id: number; name: string } | undefined;
  let isNew = false;

  if (matches.length === 1) {
    patient = matches[0];
  } else if (matches.length > 1) {
    // Several patients share this phone (a family). Tell them apart by first name.
    const firstName = fold(name).split(/\s+/)[0];
    const byName = firstName ? matches.filter((m) => fold(m.name).includes(firstName)) : [];
    if (byName.length !== 1) {
      return { ok: false, reason: 'ambiguous_patient', instruction: `Several patients share that phone and they cannot be told apart. ${TO_RECEPTION}` };
    }
    patient = byName[0];
  } else {
    if (!name) {
      return { ok: false, reason: 'name_needed', instruction: 'There is no record with that phone. Ask for the full name and call find_patient again.' };
    }
    [patient] = await sql<{ id: number; name: string }[]>`
      INSERT INTO patients (name, phone, is_new) VALUES (${name}, ${phone}, true) RETURNING id, name`;
    isNew = true;
  }

  const treatments = await sql<{ code: string; name: string }[]>`
    SELECT code, ${nameColumn(sql, lang)} AS name FROM treatments ORDER BY code`;

  return {
    ok: true,
    patient_id: patient.id,
    patient_name: patient.name,
    is_new_patient: isNew,
    treatments, // the only visit reasons the agent can book
    calendar: calendar(HORIZON_DAYS, lang), // the only dates the agent can use
  };
}

// ---------------------------------------------------------------------------------------
// 2. get_options
// ---------------------------------------------------------------------------------------

export async function getOptions(
  sql: Sql,
  input: { date?: string; treatment?: string; language?: string },
  conversationId: string | null,
  now: Date = new Date(),
): Promise<ToolResult> {
  // Without a call id the offers below would be stored unattached, and book() could then accept
  // them from any later call. The voice platform must send conversation_id on every tool
  // (see docs/voice-agent-setup.md). Refuse rather than offer something unsafe to book.
  if (!conversationId) {
    return {
      ok: false,
      reason: 'missing_conversation_id',
      instruction: `This call has no identifier, so no appointment can be offered or booked in it. ${TO_RECEPTION}`,
    };
  }

  const lang = toLang(input.language);
  const today = madridToday(now);
  const lastDay = addDays(today, HORIZON_DAYS - 1);
  const date = input.date;

  if (!isValidIsoDate(date) || date < today || date > lastDay) {
    return {
      ok: false,
      reason: 'date_out_of_range',
      instruction: `Appointments can only be booked between today and ${dayLabel(lastDay, lang)}. Use a date from the calendar returned by find_patient, or ask for another day.`,
    };
  }

  const [treatment] = await sql<{ code: string; name: string; duration_min: number }[]>`
    SELECT code, ${nameColumn(sql, lang)} AS name, duration_min FROM treatments WHERE code = ${String(input.treatment ?? '')}`;
  if (!treatment) {
    return { ok: false, reason: 'unknown_treatment', instruction: `That reason for the visit is not in the list. ${TO_RECEPTION}` };
  }

  // Working hours of each doctor that day, converted from clinic local time to instants.
  const sessions = await sql<{ doctor_id: number; doctor: string; starts: Date; ends: Date }[]>`
    SELECT s.doctor_id, d.${nameColumn(sql, lang)} AS doctor,
           (${date}::date + s.start_time) AT TIME ZONE 'Europe/Madrid' AS starts,
           (${date}::date + s.end_time)   AT TIME ZONE 'Europe/Madrid' AS ends
    FROM schedules s JOIN doctors d ON d.id = s.doctor_id
    WHERE s.weekday = EXTRACT(ISODOW FROM ${date}::date)`;
  if (sessions.length === 0) {
    return { ok: false, reason: 'clinic_closed', instruction: `The clinic is closed on ${dayLabel(date, lang)}. Ask once whether another day would suit.` };
  }

  const busy = await sql<{ doctor_id: number; starts_at: Date; ends_at: Date }[]>`
    SELECT doctor_id, starts_at, ends_at FROM appointments
    WHERE status = 'confirmed'
      AND starts_at < ((${date}::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid')
      AND ends_at   > (${date}::date::timestamp AT TIME ZONE 'Europe/Madrid')`;

  const toInterval = (doctorId: number, start: Date, end: Date): DoctorInterval => ({ doctorId, start: start.getTime(), end: end.getTime() });

  const options = rankOptions(
    sessions.map((s) => toInterval(s.doctor_id, s.starts, s.ends)),
    busy.map((b) => toInterval(b.doctor_id, b.starts_at, b.ends_at)),
    treatment.duration_min,
    {
      minUsefulMin: MIN_USEFUL_MIN,
      notBefore: date === today ? now.getTime() + MIN_NOTICE_MIN * 60_000 : 0,
      max: MAX_OPTIONS,
    },
  );

  if (options.length === 0) {
    return {
      ok: false,
      reason: 'no_gaps',
      instruction: `There is no gap left for ${treatment.name} on ${dayLabel(date, lang)}. Ask once whether another day would suit. If not, hand over to reception: ${TO_RECEPTION}`,
    };
  }

  // Store what was offered. book() only accepts these ids.
  const doctorName = new Map(sessions.map((s) => [s.doctor_id, s.doctor]));
  const offered = [];
  for (const o of options) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO offers (conversation_id, doctor_id, treatment_code, starts_at, ends_at, reason)
      VALUES (${conversationId}, ${o.doctorId}, ${treatment.code}, ${new Date(o.start)}, ${new Date(o.end)}, ${o.reason})
      RETURNING id`;
    offered.push({ option_id: row.id, time: timeLabel(o.start, lang), doctor: doctorName.get(o.doctorId) });
  }

  return { ok: true, day: dayLabel(date, lang), treatment: treatment.name, options: offered };
}

// ---------------------------------------------------------------------------------------
// 3. book
// ---------------------------------------------------------------------------------------

export async function book(
  sql: Sql,
  input: { option_id?: number | string; patient_id?: number | string; language?: string },
  conversationId: string | null,
): Promise<ToolResult> {
  // Without a call id the offer cannot be tied to this call, so "only what was offered in this
  // call" is unverifiable. Refuse rather than book something that may belong to another call.
  if (!conversationId) {
    return {
      ok: false,
      reason: 'missing_conversation_id',
      instruction: `This call has no identifier, so the chosen option cannot be verified. ${TO_RECEPTION}`,
    };
  }

  const lang = toLang(input.language);
  const optionId = Number(input.option_id);
  const patientId = Number(input.patient_id);
  const retry = 'That option is not valid. Call get_options again and offer only what it returns.';

  if (!Number.isInteger(optionId) || !Number.isInteger(patientId)) {
    return { ok: false, reason: 'unknown_option', instruction: retry };
  }

  const [offer] = await sql<
    { conversation_id: string | null; doctor_id: number; doctor: string; treatment_code: string; treatment: string; starts_at: Date; ends_at: Date }[]
  >`
    SELECT o.conversation_id, o.doctor_id, d.${nameColumn(sql, lang)} AS doctor,
           o.treatment_code, t.${nameColumn(sql, lang)} AS treatment, o.starts_at, o.ends_at
    FROM offers o JOIN doctors d ON d.id = o.doctor_id JOIN treatments t ON t.code = o.treatment_code
    WHERE o.id = ${optionId}`;

  // The agent can only book something the engine offered in this same call. All three parts are
  // required: an offer that exists, that carries a call id, and whose id is this call's. An offer
  // with no call id is one stored before get_options started demanding one, and is not bookable.
  if (!offer || !offer.conversation_id || offer.conversation_id !== conversationId) {
    return { ok: false, reason: 'unknown_option', instruction: retry };
  }

  const [patient] = await sql<{ id: number }[]>`SELECT id FROM patients WHERE id = ${patientId}`;
  if (!patient) {
    return { ok: false, reason: 'unknown_patient', instruction: 'That patient does not exist. Call find_patient before booking.' };
  }

  try {
    await sql`
      INSERT INTO appointments (doctor_id, patient_id, treatment_code, starts_at, ends_at, source, conversation_id, language)
      VALUES (${offer.doctor_id}, ${patientId}, ${offer.treatment_code}, ${offer.starts_at}, ${offer.ends_at}, 'agent', ${conversationId}, ${lang})`;
  } catch (error) {
    // 23P01 = exclusion_violation: someone else took that slot a moment ago.
    if ((error as { code?: string }).code === '23P01') {
      return { ok: false, reason: 'slot_taken', instruction: 'That slot has just been taken. Apologise, call get_options again and offer the new options.' };
    }
    throw error;
  }

  const day = dayLabel(madridToday(offer.starts_at), lang);
  const time = timeLabel(offer.starts_at.getTime(), lang);
  return {
    ok: true,
    confirmation:
      lang === 'en'
        ? `${offer.treatment} on ${day} at ${time} with ${offer.doctor}`
        : `${offer.treatment} el ${day} a las ${time} con ${offer.doctor}`,
  };
}

// ---------------------------------------------------------------------------------------
// 4. note_for_reception
// ---------------------------------------------------------------------------------------

export async function noteForReception(
  sql: Sql,
  input: { name?: string; phone?: string; reason?: string; preference?: string; urgent?: boolean | string; language?: string },
  conversationId: string | null,
): Promise<ToolResult> {
  const lang = toLang(input.language);
  const urgent = input.urgent === true || input.urgent === 'true';
  await sql`
    INSERT INTO reception_queue (conversation_id, name, phone, reason, preference, urgent, language)
    VALUES (${conversationId}, ${input.name ?? null}, ${normalizePhone(input.phone) || null}, ${input.reason ?? null}, ${input.preference ?? null}, ${urgent}, ${lang})`;

  return { ok: true, callback_day: nextWorkingDayLabel(lang) };
}
