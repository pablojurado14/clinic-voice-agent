-- Schema for the after-hours booking agent demo.
-- All data is synthetic. Safe to re-run: it drops and recreates everything.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP TABLE IF EXISTS tool_events, reception_queue, offers, appointments, patients, schedules, treatments, doctors CASCADE;

-- Anything the agent says out loud is stored in both languages (Spanish and English).
CREATE TABLE doctors (
  id      serial PRIMARY KEY,
  name_es text NOT NULL,                   -- 'la doctora Marín'
  name_en text NOT NULL                    -- 'Dr. Marín'
);

CREATE TABLE treatments (
  code         text PRIMARY KEY,           -- what the agent sends: 'checkup', 'cleaning', ...
  name_es      text NOT NULL,              -- what the agent says in Spanish
  name_en      text NOT NULL,              -- what the agent says in English
  duration_min int  NOT NULL CHECK (duration_min > 0)
);

-- Working hours per doctor and ISO weekday (1 = Monday ... 7 = Sunday), local clinic time.
CREATE TABLE schedules (
  doctor_id  int  NOT NULL REFERENCES doctors,
  weekday    int  NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time   time NOT NULL CHECK (end_time > start_time),
  PRIMARY KEY (doctor_id, weekday, start_time)
);

CREATE TABLE patients (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL,                -- digits only, no country prefix. Not unique on purpose (families share phones).
  is_new     boolean NOT NULL DEFAULT false, -- created by the agent during a call
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_phone_idx ON patients (phone);

CREATE TABLE appointments (
  id              serial PRIMARY KEY,
  doctor_id       int  NOT NULL REFERENCES doctors,
  patient_id      int  NOT NULL REFERENCES patients,
  treatment_code  text NOT NULL REFERENCES treatments,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL CHECK (ends_at > starts_at),
  source          text NOT NULL CHECK (source IN ('reception', 'agent')),
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  conversation_id text,
  language        text CHECK (language IN ('es', 'en')), -- language of the call, if booked by the agent
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- "A slot that has been given is gone": the database itself refuses two confirmed
  -- appointments that overlap for the same doctor. Two simultaneous calls cannot
  -- both win the same slot, whatever the agent says.
  CONSTRAINT no_double_booking EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE INDEX appointments_starts_idx ON appointments (starts_at);

-- Every option the engine offers during a call is stored here.
-- The agent can only book an offer id, so it cannot book a time it made up.
CREATE TABLE offers (
  id              serial PRIMARY KEY,
  conversation_id text,
  doctor_id       int  NOT NULL REFERENCES doctors,
  treatment_code  text NOT NULL REFERENCES treatments,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason          text,                     -- why the engine picked it (shown later in the console)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Anything the agent could not resolve: reception calls back next working day.
CREATE TABLE reception_queue (
  id              serial PRIMARY KEY,
  conversation_id text,
  name            text,
  phone           text,
  reason          text,
  preference      text,
  urgent          boolean NOT NULL DEFAULT false,
  language        text CHECK (language IN ('es', 'en')), -- so reception calls back in the right language
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

-- One row per tool call: input, output and latency. Feeds the console and the evals.
CREATE TABLE tool_events (
  id              bigserial PRIMARY KEY,
  conversation_id text,
  tool            text NOT NULL,
  input           jsonb,
  output          jsonb,
  ms              int,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_events_conversation_idx ON tool_events (conversation_id, created_at);
