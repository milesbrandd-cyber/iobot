// lib/ics.js
// A small, dependency-free iCalendar (.ics) parser.
//
// Why write our own instead of using a library?
//   The bell-schedule feed only uses a handful of iCal features (VEVENT,
//   DTSTART/DTEND, SUMMARY, CREATED, LAST-MODIFIED). A ~100-line parser we can
//   read top to bottom is easier to explain and debug than a big library.
//
// iCal format in one paragraph:
//   The file is plain text, one "PROPERTY;PARAM=VALUE:value" per line.
//   Long lines are "folded": a line that starts with a space or tab is a
//   continuation of the line above it. Each event sits between
//   BEGIN:VEVENT and END:VEVENT.

// Hawaiʻi does not use daylight saving time, so Honolulu is ALWAYS UTC-10.
// That lets us convert times with simple arithmetic instead of a time-zone library.
const HONOLULU_OFFSET_MINUTES = -10 * 60;

/**
 * Step 1: undo line folding.
 * "SUMMARY:A very lo\r\n ng title" becomes "SUMMARY:A very long title".
 */
function unfoldLines(text) {
  return text
    .replace(/\r\n/g, "\n")          // normalize Windows line endings
    .replace(/\n[ \t]/g, "")          // a newline followed by space/tab = continuation
    .split("\n");
}

/**
 * iCal escapes some characters in text values: \, \; \n \\
 * The feed writes "E Schedule (3\,4\,1\,2)", which should read "E Schedule (3,4,1,2)".
 */
function unescapeText(value) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\([,;\\])/g, "$1");
}

/**
 * Split one content line into its name, parameters, and value.
 * "DTSTART;VALUE=DATE:20261020" -> { name: "DTSTART", params: { VALUE: "DATE" }, value: "20261020" }
 */
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(";");
  const params = {};
  for (const part of paramParts) {
    const [k, v] = part.split("=");
    params[k.toUpperCase()] = v;
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Convert an iCal date/time into a Honolulu calendar date + minutes after midnight.
 *
 * The feed uses three formats:
 *   1. All-day:     DTSTART;VALUE=DATE:20261020          -> date only
 *   2. UTC:         DTSTART:20261020T174000Z             -> the "Z" means UTC
 *   3. Local time:  DTSTART;TZID=Pacific/Honolulu:20261020T074000
 *
 * IMPORTANT BUG THIS AVOIDS: the last class of the day (2:05-3:00 pm) is stored
 * in UTC as 00:05 on the NEXT day. If we grouped by the UTC date, last period
 * would show up on the wrong day. So we always convert to Honolulu time first,
 * and only then read off the date.
 */
function parseDateTime(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , isUtc] = m;

  // Case 1: all-day event (no time part)
  if (hh === undefined || params.VALUE === "DATE") {
    return { allDay: true, date: `${y}-${mo}-${d}`, minutes: 0 };
  }

  // Build a timestamp in UTC milliseconds.
  let utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm);
  if (!isUtc) {
    // Case 3: the time is already Honolulu local time; shift it to real UTC.
    // (Any other TZID would need a real time-zone library; this feed only uses Honolulu.)
    utcMs -= HONOLULU_OFFSET_MINUTES * 60 * 1000;
  }

  // Now shift UTC -> Honolulu and read the calendar fields.
  const local = new Date(utcMs + HONOLULU_OFFSET_MINUTES * 60 * 1000);
  const date = local.toISOString().slice(0, 10); // "YYYY-MM-DD" in Honolulu
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { allDay: false, date, minutes, utcMs };
}

/**
 * Parse an entire .ics file into a simple array of events:
 * { summary, allDay, date, start, end, created, modified, hasRule }
 * start/end are minutes after midnight, Honolulu time.
 */
function parseICS(text) {
  const events = [];
  let current = null;

  for (const raw of unfoldLines(text)) {
    if (raw === "BEGIN:VEVENT") { current = {}; continue; }
    if (raw === "END:VEVENT") {
      if (current && current.start) events.push(finishEvent(current));
      current = null;
      continue;
    }
    if (!current) continue; // ignore calendar-level lines

    const line = parseLine(raw);
    if (!line) continue;
    switch (line.name) {
      case "SUMMARY":       current.summary = unescapeText(line.value).trim(); break;
      case "DTSTART":       current.start = parseDateTime(line.value, line.params); break;
      case "DTEND":         current.end = parseDateTime(line.value, line.params); break;
      case "CREATED":       current.created = parseDateTime(line.value, line.params); break;
      case "LAST-MODIFIED": current.modified = parseDateTime(line.value, line.params); break;
      case "RRULE":         current.hasRule = true; break;
      case "UID":           current.uid = line.value.trim(); break;
    }
  }
  return events;
}

function finishEvent(e) {
  return {
    uid: e.uid || null,
    summary: e.summary || "",
    allDay: e.start.allDay,
    date: e.start.date,
    start: e.start.minutes,
    // If an event has no end, treat it as ending when it starts.
    end: e.end && !e.end.allDay ? e.end.minutes : e.start.minutes,
    endDate: e.end ? e.end.date : e.start.date,
    created: e.created ? e.created.utcMs : null,
    modified: e.modified ? e.modified.utcMs : null,
    hasRule: !!e.hasRule,
  };
}

module.exports = { parseICS, parseDateTime, unescapeText, HONOLULU_OFFSET_MINUTES };
