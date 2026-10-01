// Creates the schema and fills it with a synthetic two-week agenda.
// Re-run it any time to reset the demo:  npm run db:setup
//
// Every name, phone and appointment below is invented.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { HORIZON_DAYS } from '../src/lib/config';
import { addDays, isoWeekday, madridToday } from '../src/lib/time';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (put it in .env.local)');
const sql = postgres(url, { prepare: false, onnotice: () => {} });

// Small seeded random generator, so every reset produces the same agenda shape.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(2026);
const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];

// Spoken name in Spanish, spoken name in English
const DOCTORS: [string, string][] = [
  ['la doctora Marín', 'Dr. Marín'],
  ['el doctor Ortega', 'Dr. Ortega'],
];

// code, Spanish name, English name, minutes, relative frequency in the agenda
const TREATMENTS: [string, string, string, number, number][] = [
  ['checkup', 'revisión', 'check-up', 30, 35],
  ['cleaning', 'limpieza', 'cleaning', 45, 25],
  ['filling', 'empaste', 'filling', 45, 25],
  ['root_canal', 'endodoncia', 'root canal', 90, 10],
  ['emergency', 'visita de urgencia', 'emergency visit', 30, 5],
];

// Monday to Friday, morning and afternoon, in minutes from midnight.
const SESSIONS: [number, number][] = [
  [9 * 60, 14 * 60],
  [16 * 60, 20 * 60],
];

const FIRST = ['Lucía', 'Marcos', 'Carmen', 'Javier', 'Elena', 'Andrés', 'Paula', 'Sergio', 'Irene', 'Raúl', 'Nuria', 'Óscar', 'Marta', 'Diego', 'Alba'];
const LAST = ['Herrero', 'Campos', 'Vidal', 'Rubio', 'Santos', 'Molina', 'Cano', 'Prieto', 'Lozano', 'Gallego'];

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function pickTreatment(maxMinutes: number) {
  const fitting = TREATMENTS.filter((t) => t[3] <= maxMinutes);
  if (fitting.length === 0) return null;
  let roll = random() * fitting.reduce((sum, t) => sum + t[4], 0);
  for (const t of fitting) if ((roll -= t[4]) <= 0) return t;
  return fitting[0];
}

async function main() {
  const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
  await sql.unsafe(readFileSync(schemaPath, 'utf8'));

  for (const [es, en] of DOCTORS) await sql`INSERT INTO doctors (name_es, name_en) VALUES (${es}, ${en})`;
  for (const [code, es, en, duration] of TREATMENTS) {
    await sql`INSERT INTO treatments (code, name_es, name_en, duration_min) VALUES (${code}, ${es}, ${en}, ${duration})`;
  }
  const doctors = await sql<{ id: number }[]>`SELECT id FROM doctors ORDER BY id`;
  for (const d of doctors) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      for (const [from, to] of SESSIONS) {
        await sql`INSERT INTO schedules (doctor_id, weekday, start_time, end_time) VALUES (${d.id}, ${weekday}, ${hhmm(from)}, ${hhmm(to)})`;
      }
    }
  }

  // 30 patients with phones 600000001..600000030. Patients 29 and 30 share a phone on purpose.
  const patientIds: number[] = [];
  for (let i = 1; i <= 30; i++) {
    const phone = `6000000${String(i === 30 ? 29 : i).padStart(2, '0')}`;
    const name = `${FIRST[(i - 1) % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const [row] = await sql<{ id: number }[]>`INSERT INTO patients (name, phone) VALUES (${name}, ${phone}) RETURNING id`;
    patientIds.push(row.id);
  }

  // Fill every session back to back, then free 3 or 4 appointments per day: those are the gaps to sell.
  const today = madridToday();
  let booked = 0;
  let freed = 0;
  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const date = addDays(today, offset);
    if (isoWeekday(date) > 5) continue;

    const dayAppointments: { doctorId: number; code: string; from: number; to: number }[] = [];
    for (const d of doctors) {
      for (const [from, to] of SESSIONS) {
        let cursor = from;
        for (;;) {
          const treatment = pickTreatment(to - cursor);
          if (!treatment) break;
          dayAppointments.push({ doctorId: d.id, code: treatment[0], from: cursor, to: cursor + treatment[3] });
          cursor += treatment[3];
        }
      }
    }

    const toFree = 3 + Math.floor(random() * 2);
    for (let i = 0; i < toFree && dayAppointments.length > 0; i++) {
      dayAppointments.splice(Math.floor(random() * dayAppointments.length), 1);
      freed++;
    }

    for (const a of dayAppointments) {
      await sql`
        INSERT INTO appointments (doctor_id, patient_id, treatment_code, starts_at, ends_at, source)
        VALUES (${a.doctorId}, ${pick(patientIds)}, ${a.code},
                (${date}::date + make_interval(mins => ${a.from})) AT TIME ZONE 'Europe/Madrid',
                (${date}::date + make_interval(mins => ${a.to}))   AT TIME ZONE 'Europe/Madrid',
                'reception')`;
      booked++;
    }
  }

  console.log(`Schema created. ${booked} appointments booked, ${freed} gaps left open, from ${today} for ${HORIZON_DAYS} days.`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
