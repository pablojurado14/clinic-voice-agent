// End-to-end check of the four tools against a real database.
// Resets nothing: run `npm run db:setup` first, then `npm run test:db`.

import assert from 'node:assert/strict';
import postgres from 'postgres';
import { HORIZON_DAYS } from '../src/lib/config';
import { book, findPatient, getOptions, noteForReception } from '../src/lib/tools';
import { addDays, isoWeekday, madridToday } from '../src/lib/time';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const step = (label: string) => console.log(`ok  ${label}`);

// First weekday after today, so "same-day notice" never interferes.
let date = addDays(madridToday(), 1);
while (isoWeekday(date) > 5) date = addDays(date, 1);

async function main() {
  // 1. Known patient by phone, with prefix and spaces.
  const known: any = await findPatient(sql, { phone: '+34 600 00 00 01' });
  assert.equal(known.ok, true);
  assert.equal(known.is_new_patient, false);
  assert.equal(known.calendar.length, HORIZON_DAYS);
  step(`known patient found: ${known.patient_name}`);

  // 2. Unknown phone without a name -> ask for the name; with a name -> new patient.
  const noName: any = await findPatient(sql, { phone: '611222333' });
  assert.equal(noName.reason, 'name_needed');
  const created: any = await findPatient(sql, { phone: '611222333', name: 'Prueba Demo' });
  assert.equal(created.is_new_patient, true);
  step('new patient created only when a name is given');

  // 3. Shared phone: ambiguous without a name, resolved with one.
  const shared: any = await findPatient(sql, { phone: '600000029' });
  assert.equal(shared.reason, 'ambiguous_patient');
  const family = await sql<{ name: string }[]>`SELECT name FROM patients WHERE phone = '600000029' ORDER BY id`;
  const resolved: any = await findPatient(sql, { phone: '600000029', name: family[1].name });
  assert.equal(resolved.patient_name, family[1].name);
  step('shared phone resolved by first name');

  // 4. Bad inputs never produce options.
  assert.equal(((await getOptions(sql, { date: '2020-01-01', treatment: 'checkup' }, 'c1')) as any).reason, 'date_out_of_range');
  assert.equal(((await getOptions(sql, { date, treatment: 'whitening' }, 'c1')) as any).reason, 'unknown_treatment');
  let weekend = date;
  while (isoWeekday(weekend) !== 6) weekend = addDays(weekend, 1);
  if (weekend <= addDays(madridToday(), HORIZON_DAYS - 1)) {
    assert.equal(((await getOptions(sql, { date: weekend, treatment: 'checkup' }, 'c1')) as any).reason, 'clinic_closed');
  }
  step('out-of-range date, unknown treatment and closed day are rejected');

  // 5. Happy path: options, book one, and it disappears.
  const first: any = await getOptions(sql, { date, treatment: 'checkup' }, 'c1');
  assert.equal(first.ok, true);
  assert.ok(first.options.length >= 1 && first.options.length <= 3);
  step(`options for ${first.day}: ${first.options.map((o: any) => o.time).join(', ')}`);

  const chosen = first.options[0];
  const booked: any = await book(sql, { option_id: chosen.option_id, patient_id: known.patient_id }, 'c1');
  assert.equal(booked.ok, true);
  step(`booked: ${booked.confirmation}`);

  const second: any = await getOptions(sql, { date, treatment: 'checkup' }, 'c2');
  if (second.ok) assert.ok(!second.options.some((o: any) => o.time === chosen.time && o.doctor === chosen.doctor));
  step('the booked slot is no longer offered');

  // 6. A second caller holding the same old option cannot take it.
  const again: any = await book(sql, { option_id: chosen.option_id, patient_id: created.patient_id }, 'c1');
  assert.equal(again.reason, 'slot_taken');
  step('double booking is refused by the database');

  // 7. The agent cannot book something that was never offered, or offered in another call.
  assert.equal(((await book(sql, { option_id: 999999, patient_id: known.patient_id }, 'c1')) as any).reason, 'unknown_option');
  if (second.ok) {
    assert.equal(((await book(sql, { option_id: second.options[0].option_id, patient_id: known.patient_id }, 'c1')) as any).reason, 'unknown_option');
  }
  step('made-up or foreign option ids are refused');

  // 8. Two callers racing for the same slot: exactly one wins.
  const raceA: any = await getOptions(sql, { date, treatment: 'checkup' }, 'race-a');
  const raceB: any = await getOptions(sql, { date, treatment: 'checkup' }, 'race-b');
  if (raceA.ok && raceB.ok) {
    const results: any[] = await Promise.all([
      book(sql, { option_id: raceA.options[0].option_id, patient_id: known.patient_id }, 'race-a'),
      book(sql, { option_id: raceB.options[0].option_id, patient_id: created.patient_id }, 'race-b'),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => r.reason === 'slot_taken').length, 1);
    step('race for the same slot: one booking, one refusal');
  }

  // 9. Same flow in English: spoken fields come back in English, the agenda is the same.
  const english: any = await findPatient(sql, { phone: '600000003', language: 'en' });
  assert.ok(english.calendar[1].label.startsWith('tomorrow, '));
  assert.ok(english.treatments.some((t: any) => t.name === 'check-up'));
  // Look for the first day with a cleaning gap, as a caller would after hearing "nothing that day".
  let englishOptions: any = { ok: false };
  for (const day of english.calendar.slice(1)) {
    englishOptions = await getOptions(sql, { date: day.date, treatment: 'cleaning', language: 'en' }, 'c-en');
    if (englishOptions.ok) break;
  }
  assert.equal(englishOptions.ok, true);
  assert.match(englishOptions.options[0].time, /^\d{1,2}:\d{2} (am|pm)$/);
  assert.ok(englishOptions.options[0].doctor.startsWith('Dr. '));
  const englishBooked: any = await book(sql, { option_id: englishOptions.options[0].option_id, patient_id: english.patient_id, language: 'en' }, 'c-en');
  assert.match(englishBooked.confirmation, /^cleaning on .+ at .+ with Dr\. /);
  const [stored] = await sql`SELECT language FROM appointments WHERE conversation_id = 'c-en'`;
  assert.equal(stored.language, 'en');
  step(`booked in English: ${englishBooked.confirmation}`);

  // 10. Fallback to reception.
  const note: any = await noteForReception(sql, { name: 'Prueba Demo', phone: '611 222 333', reason: 'dolor de muela', preference: 'por la tarde', urgent: 'true' }, 'c3');
  assert.equal(note.ok, true);
  const [queued] = await sql`SELECT urgent, phone, language FROM reception_queue WHERE conversation_id = 'c3'`;
  assert.equal(queued.language, 'es');
  assert.equal(queued.urgent, true);
  assert.equal(queued.phone, '611222333');
  step(`noted for reception, callback: ${note.callback_day}`);

  console.log('\nAll checks passed.');
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
