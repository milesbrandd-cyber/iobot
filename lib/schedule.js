// lib/schedule.js
// Turns the raw list of calendar events into one clean object per school day.
//
// Feed A ("Bell Schedule with Periods") gives us two kinds of events per day:
//   - ONE all-day event that names the day:  "E Schedule (3,4,1,2) (Grs. 9&10 Chapel)"
//   - SEVERAL timed events, one per block:   "Period 3" 8:15-9:25, "Lunch" 11:45-12:30 ...
// Holidays only have the all-day event and no timed blocks.

/** Clean up messy labels: double spaces, stray commas, extra whitespace. */
function tidy(label) {
  return label
    .replace(/\s+/g, " ")         // "A Schedule  (Grs..." -> "A Schedule (Grs..."
    .replace(/,\s*\)/g, ")")      // "(7,8,5,6,)" -> "(7,8,5,6)"
    .trim();
}

/**
 * Read everything we can out of a day label.
 * "E Schedule (3,4,1,2) (Grs. 9&10 Chapel)" ->
 *   { letter: "E", variant: "E", order: [3,4,1,2], chapelGrades: [9,10], noChapel: false }
 */
function parseDayLabel(label) {
  const info = { letter: null, variant: null, order: null, chapelGrades: [], noChapel: false, special: false };

  // Letter days: "A Schedule", "E1 Schedule", "Special A Schedule"
  const letter = label.match(/^(Special\s+)?([A-F])(\d?)\s+Schedule/i);
  if (letter) {
    info.special = !!letter[1];
    info.letter = letter[2].toUpperCase();
    info.variant = info.letter + (letter[3] || ""); // "E1", "F2"...
  } else if (/schedule/i.test(label)) {
    // "PSAT Schedule Day", "Special Fair Day Schedule", "Chapel (No Chapel) Schedule"
    info.special = true;
  }

  // Period order: the first parenthesis made only of digits and commas.
  const order = label.match(/\((\d(?:\s*,\s*\d)+)\)/);
  if (order) info.order = order[1].split(",").map(Number);

  // Chapel: "(Grs. 9&10 Chapel)", "(Gr. 11 Chapel)", "(Grs. 7 & 8 Chapel)",
  //         "(Gr. 7 Chapel/Gr. 8 remain in HR)" -> only grade 7 has chapel.
  if (/no chapel/i.test(label)) info.noChapel = true;
  const chapel = label.match(/\(\s*Grs?\.\s*([\d\s&,and]+?)\s*Chapel/i);
  if (chapel) info.chapelGrades = (chapel[1].match(/\d+/g) || []).map(Number);

  return info;
}

/** Decide what kind of block a timed event is. */
function classifyBlock(name) {
  const p = name.match(/^(?:Period|Per|Pd)\.?\s*(\d)/i);
  if (p) return { kind: "period", period: Number(p[1]) };
  if (/chapel|assembly/i.test(name) && !/home\s*room|^hr\b/i.test(name)) return { kind: "chapel" };
  if (/home\s*room|^hr\b/i.test(name)) return { kind: "homeroom" }; // "Homeroom/Chapel" too
  if (/lunch/i.test(name)) return { kind: /meeting|mtg/i.test(name) ? "meeting" : "lunch" };
  if (/break/i.test(name)) return { kind: "break" };
  if (/meeting|mtg/i.test(name)) return { kind: "meeting" };
  return { kind: "other" };
}

// Words that mean "no Upper School classes today".
const NO_SCHOOL = /holiday|break|vacation|no us|no school|christmas!|new year|campus closed/i;

/** "07:40" style string for minutes after midnight. */
function hhmm(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/**
 * Work out which school year a date belongs to. A school year runs Aug 1 - Jul 31.
 * Example: 2026-10-20 -> { start: "2026-08-01", end: "2027-07-31", name: "2026-27" }
 */
function schoolYearFor(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const startYear = m >= 8 ? y : y - 1;
  return {
    start: `${startYear}-08-01`,
    end: `${startYear + 1}-07-31`,
    name: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
  };
}

/**
 * Main function: events -> { schoolYear, days: { "YYYY-MM-DD": {...} } }
 * `today` is a "YYYY-MM-DD" string in Honolulu time.
 */
function buildSchedule(events, today) {
  const year = schoolYearFor(today);

  // 1. Keep only this school year. The feed goes back to 2014, so this drops
  //    ~19,000 old events and makes the response tiny.
  const inYear = events.filter(e => e.date >= year.start && e.date <= year.end && !e.hasRule);

  // 2. Group by Honolulu date.
  const byDate = {};
  for (const e of inYear) (byDate[e.date] ||= []).push(e);

  const days = {};
  for (const [date, list] of Object.entries(byDate).sort()) {
    const labels = list.filter(e => e.allDay).map(e => tidy(e.summary));

    // Timed blocks: sort by start time and drop exact duplicates.
    const seen = new Set();
    const blocks = list
      .filter(e => !e.allDay)
      .sort((a, b) => a.start - b.start)
      .filter(e => { const k = `${e.start}-${e.end}-${e.summary}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(e => ({ start: hhmm(e.start), end: hhmm(e.end), name: tidy(e.summary), ...classifyBlock(e.summary) }));

    // The main label is the one that describes a schedule, if there is one.
    const label = labels.find(l => /schedule/i.test(l)) || labels[0] || "";
    const info = parseDayLabel(label);

    let type;
    if (blocks.length) type = info.special || !info.letter ? "special" : "regular";
    // A school day with no bell times in the feed, e.g. "PSAT Schedule Day" or "US FINAL EXAMS".
    else if ((/schedule|exam/i.test(label)) && !NO_SCHOOL.test(label)) type = "special-no-times";
    else type = "no-school";

    // "Changed" = an event on this day was edited more than a day after it was created.
    // That's how we can flag mid-year schedule changes to students.
    let changedAt = null;
    for (const e of list) {
      if (e.created && e.modified && e.modified - e.created > 24 * 3600 * 1000) {
        changedAt = Math.max(changedAt || 0, e.modified);
      }
    }

    days[date] = {
      label, labels, type, blocks,
      letter: info.letter, variant: info.variant, order: info.order,
      chapelGrades: info.chapelGrades, noChapel: info.noChapel,
      changedAt: changedAt ? new Date(changedAt).toISOString() : null,
    };
  }

  return { schoolYear: year.name, range: [year.start, year.end], days };
}

module.exports = { buildSchedule, parseDayLabel, classifyBlock, tidy, schoolYearFor };
