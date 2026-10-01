// Clinic settings. Every value here is a demo default, meant to be calibrated with a real clinic.

export const CLINIC_NAME = 'Clínica Dental Alameda'; // fictional

/** How many days ahead the agent can book. The seed fills exactly this window. */
export const HORIZON_DAYS = 14;

/** Shortest appointment the clinic sells. A leftover gap below this counts as dead time. */
export const MIN_USEFUL_MIN = 30;

/** Same-day bookings need at least this much notice. */
export const MIN_NOTICE_MIN = 60;

/** Options read out per request. By phone, nobody retains more than three. */
export const MAX_OPTIONS = 3;
