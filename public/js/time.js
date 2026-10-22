// js/time.js
// Every time IoBot shows is ʻIolani time (Pacific/Honolulu), even if a
// student's iPad is set to another time zone (for example, while traveling).

const TZ = "Pacific/Honolulu";

// Intl.DateTimeFormat does the time-zone conversion for us inside the browser.
const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** The current moment in Honolulu: { date: "2026-10-20", seconds: 31530 } */
export function honoluluNow(at = new Date()) {
  const p = Object.fromEntries(partsFormatter.formatToParts(at).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    seconds: (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second),
  };
}

/** "13:45" -> seconds after midnight */
export function toSeconds(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
}

/** "13:45" -> "1:45" (school clocks don't need am/pm during the day) */
export function clock(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return { text: `${h}:${String(m).padStart(2, "0")}`, suffix };
}

/** 754 seconds -> "12:34"; 4000 -> "1:06:40" */
export function countdown(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---- Date helpers. Dates are plain "YYYY-MM-DD" strings everywhere in the app.
// We do math on them at noon UTC so a time zone can never push us to the wrong day.

function toDate(iso) { return new Date(iso + "T12:00:00Z"); }

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(iso) { return toDate(iso).getUTCDay(); } // 0 = Sunday

export function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }

/** Monday of the week containing `iso` (weekends jump forward to next Monday). */
export function weekMonday(iso) {
  const dow = dayOfWeek(iso);
  if (dow === 6) return addDays(iso, 2);
  if (dow === 0) return addDays(iso, 1);
  return addDays(iso, 1 - dow);
}

export function formatDate(iso, options) {
  return toDate(iso).toLocaleDateString("en-US", { timeZone: "UTC", ...options });
}
