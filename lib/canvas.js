// lib/canvas.js
// Reads a student's personal Canvas calendar feed and pulls out two things:
//   1. Their classes, matched to periods (so nobody has to type their schedule)
//   2. Upcoming assignment due dates
//
// Canvas writes each event's SUMMARY like:
//   "Unit 3 Problem Set [AP Microeconomics (P5)-Suzuki]"
// The part in [brackets] is the course. Some feeds include the period there as
// "(P5)"; others only mention it inside a title, like
//   "Monopoly Worksheet (AP Microeconomics (P5)-Suzuki) [AP Microeconomics-Suzuki]".
// We read both. Courses whose period never appears are listed so the student can
// pick the period once in Settings.

const { parseICS } = require("./ics");

// Only allow real ʻIolani Canvas feeds. This keeps our server from being
// used as a proxy to fetch random websites.
const ALLOWED_FEED = /^https:\/\/iolani\.instructure\.com\/feeds\/calendars\/user_[A-Za-z0-9_-]+\.ics$/;

/** "Unit 3 Problem Set [AP Microeconomics (P5)-Suzuki]" -> { title, course } */
function splitSummary(summary) {
  const m = summary.match(/^(.*)\s\[([^\]]+)\]\s*$/);
  return m ? { title: m[1].trim(), course: m[2].trim() } : { title: summary, course: null };
}

/**
 * Split a course label into name, teacher and (if present) period.
 *   "AP Microeconomics (P5)-Suzuki"   -> { period: 5, name: "AP Microeconomics", teacher: "Suzuki" }
 *   "AP Microeconomics-Suzuki"        -> { period: null, name: "AP Microeconomics", teacher: "Suzuki" }
 *   "Hawaiian Ensemble-Koanui-Souza"  -> teacher "Koanui-Souza"
 */
function parseCourse(course) {
  // Pattern: <course name> (P<digit>) - <teacher>     e.g. "AP Psychology (P4)-Jones"
  // The teacher part is optional. We only treat text as a teacher when it comes
  // right after "(P#)-", so hyphenated names like "Pre-Calculus" stay intact.
  const m = course.match(/^(.*?)\s*\(\s*P(?:er(?:iod)?)?\.?\s*(\d)\s*\)\s*(?:-\s*(.+))?$/i);
  if (m) return { period: Number(m[2]), name: m[1].trim(), teacher: m[3] ? m[3].trim() : null, raw: course };

  // No period: "<name>-<teacher>". The teacher starts at the first hyphen whose left
  // side contains a space ("AP Psychology-Jones"), so "Pre-Calculus" isn't split.
  const cut = (() => {
    for (let i = 0; i < course.length; i++) {
      if (course[i] === "-" && /\s/.test(course.slice(0, i)) && i < course.length - 1) return i;
    }
    return -1;
  })();
  if (cut > 0) return { period: null, name: course.slice(0, cut).trim(), teacher: course.slice(cut + 1).trim(), raw: course };
  return { period: null, name: course.trim(), teacher: null, raw: course };
}

/**
 * Some teachers put the full section name in the assignment title:
 *   "Monopoly Worksheet (AP Microeconomics (P5)-Suzuki)"
 * That's the only place many feeds mention a period, so we read it from there too
 * and remove it from the title. Returns { title, hint } where hint is a parsed course or null.
 */
function periodHintFromTitle(title) {
  const m = title.match(/^(.*?)\s*\(([^()]*\(\s*P\d\s*\)[^()]*)\)\s*$/i);
  if (!m) return { title, hint: null };
  const hint = parseCourse(m[2]);
  return hint.period ? { title: m[1].trim() || title, hint } : { title, hint: null };
}

/**
 * Turn the feed text into { classes, courses, assignments }.
 *   classes:     period number -> { name, teacher }   (only periods we could work out)
 *   courses:     every course in the feed, with its period or null, so the student
 *                can place the rest with one tap in Settings
 * `fromDate` limits assignments to today onward ("YYYY-MM-DD").
 */
function readCanvasFeed(text, fromDate) {
  const events = parseICS(text);
  const courses = new Map(); // bracket label -> { key, name, teacher, period }
  const items = [];

  // Pass 1: learn every course, and its period wherever any assignment reveals it.
  for (const e of events) {
    const { title: rawTitle, course } = splitSummary(e.summary);
    if (!course) continue;
    const base = parseCourse(course);
    const { title, hint } = periodHintFromTitle(rawTitle);
    const known = courses.get(course) || { key: course, name: base.name, teacher: base.teacher, period: base.period };
    if (!known.period && hint) {
      known.period = hint.period;
      if (hint.name) known.name = hint.name;
      if (hint.teacher) known.teacher = hint.teacher;
    }
    courses.set(course, known);
    items.push({ e, title, course });
  }

  // Pass 2: assignments from today on, tagged with the course's period.
  const assignments = [];
  for (const { e, title, course } of items) {
    if (e.date < fromDate) continue;
    const c = courses.get(course);
    assignments.push({
      // Canvas gives every event a stable UID, so a student's edits stay attached after re-syncing.
      id: e.uid || `${e.date}|${title}|${course}`,
      date: e.date,
      // Canvas due dates are timed events; all-day ones have no specific time.
      time: e.allDay ? null : `${String(Math.floor(e.start / 60)).padStart(2, "0")}:${String(e.start % 60).padStart(2, "0")}`,
      title,
      course: c.name,
      courseKey: c.key,
      period: c.period,
    });
  }

  const classes = {};
  for (const c of courses.values()) if (c.period) classes[c.period] = { name: c.name, teacher: c.teacher };

  assignments.sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
  return {
    classes,
    courses: [...courses.values()].sort((a, b) => (a.period || 9) - (b.period || 9) || a.name.localeCompare(b.name)),
    assignments: assignments.slice(0, 200),
  };
}

module.exports = { readCanvasFeed, parseCourse, splitSummary, periodHintFromTitle, ALLOWED_FEED };
