# Connecting the voice agent (ElevenLabs Agents)

The backend exposes four HTTP tools. The voice platform only needs the prompt, the languages, the four
tool definitions and the shared secret. Dashboard labels change over time; what matters is the fields below.

## 1. Agent and languages

- Primary language: Spanish. Additional language: English.
- First message: one per language, both in `agent/prompt.md`.
- System prompt: copy it from `agent/prompt.md`. It is a single prompt for both languages.
- Voice: choose one voice per language and test each with times and dates before anything else.
- Add the **language detection** system tool, so the agent switches when the caller speaks the other
  language. It is not enabled by default.

On a phone call there is no language picker, so the call starts in Spanish and switches on detection.
That is why the Spanish first message includes one line in English.

## 2. Tools

Create four **webhook tools**. For all of them:

- Method: `POST`
- URL: `https://YOUR-DEPLOYMENT/api/tools/<path>`
- Header: `x-tool-secret` = the value of `TOOL_SECRET` (store it as a secret if the dashboard offers it)
- Body parameter `conversation_id`: set its value type to **dynamic variable** and use `system__conversation_id`.
  The model should not fill this one in.
- Body parameter `language` (string), filled by the model: "Language being spoken with the caller
  right now: `es` or `en`."

| Tool name | Path | Other body parameters filled by the model |
|---|---|---|
| `find_patient` | `find-patient` | `name` (string), `phone` (string) |
| `get_options` | `get-options` | `date` (string, `YYYY-MM-DD`), `treatment` (string) |
| `book` | `book` | `option_id` (number), `patient_id` (number) |
| `note_for_reception` | `note-for-reception` | `name`, `phone`, `reason`, `preference` (strings), `urgent` (boolean) |

Descriptions to paste (the model reads them to decide when and how to call each tool):

**find_patient**
Looks the patient up by phone and, if there is no record, creates one with the given name. Call it as soon as you have name and phone. Returns `patient_id`, the treatments that can be booked and the calendar of available dates.
- `name`: full name as the caller said it.
- `phone`: contact phone number, digits only.

**get_options**
Returns up to three free slots for one day and one treatment. Call it every time the caller asks for a day, and again if `book` says the slot is gone.
- `date`: date as `YYYY-MM-DD`, taken from the calendar returned by `find_patient`.
- `treatment`: treatment code, taken from the list returned by `find_patient`.

**book**
Books one of the options returned by `get_options` in this same call. Call it only once the caller has chosen.
- `option_id`: the `option_id` of the chosen option.
- `patient_id`: the `patient_id` returned by `find_patient`.

**note_for_reception**
Leaves a message so reception calls the patient back on the next working day. Use it when you cannot book the appointment or when another tool tells you to.
- `name`, `phone`: the caller's details.
- `reason`: reason for the visit, in the caller's words.
- `preference`: days or times they prefer.
- `urgent`: true if there is pain or urgency.

## 3. First test calls

Reset the agenda (`npm run db:setup`) and open the agent's test call in the browser.

In Spanish:

1. A name and the phone `600 000 002` (an existing synthetic patient).
2. "Quiero una limpieza."
3. "El lunes."

In English, in a new call:

1. Answer the greeting in English with a name, then the phone `600 000 003`.
2. "I'd like a check-up."
3. "On Tuesday."

Expected in both: it reads back up to three times in the caller's language, you pick one, it confirms,
and a new row appears in `appointments` with `source = 'agent'` and the language of the call. Ask again
for the same day in another call: that time is gone.

Every tool call is stored in `tool_events` with its input, output and latency. When a call goes wrong,
start there.
