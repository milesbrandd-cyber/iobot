// lib/canvas.js
// Reads a student's personal Canvas calendar feed and pulls out two things:
//   1. Their classes, matched to periods (so nobody has to type their schedule)
//   2. Upcoming assignment due dates
//
// Canvas writes each event's SUMMARY like:
//   "Unit 3 Problem Set [AP Microeconomics (P5)-Suzuki]"
// The part in [brackets] is the course. ʻIolani puts the period in the course
// name as "(P5)", so we can read the period straight out of it.

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
 * "AP Microeconomics (P5)-Suzuki" ->
 *   { period: 5, name: "AP Microeconomics", teacher: "Suzuki" }
 */
function parseCourse(course) {
  // Pattern: <course name> (P<digit>) - <teacher>     e.g. "AP Psychology (P4)-Jones"
  // The teacher part is optional. We only treat text as a teacher when it comes
  // right after "(P#)-", so hyphenated names like "Pre-Calculus" stay intact.
  const m = course.match(/^(.*?)\s*\(\s*P(?:er(?:iod)?)?\.?\s*(\d)\s*\)\s*(?:-\s*(.+))?$/i);
  if (!m) return { period: null, name: course.trim(), teacher: null, raw: course };
  return { period: Number(m[2]), name: m[1].trim(), teacher: m[3] ? m[3].trim() : null, raw: course };
}

/**
 * Turn the feed text into { classes, assignments }.
 * `fromDate` limits assignments to today onward ("YYYY-MM-DD").
 */
function readCanvasFeed(text, fromDate) {
  const events = parseICS(text);
  const classes = {};      // period number -> { name, teacher }
  const otherCourses = new Set();
  const assignments = [];

  for (const e of events) {
    const { title, course } = splitSummary(e.summary);
    if (!course) continue;
    const c = parseCourse(course);
    if (c.period) classes[c.period] = { name: c.name, teacher: c.teacher };
    else otherCourses.add(c.name || course);

    if (e.date >= fromDate) {
      assignments.push({
        date: e.date,
        // Canvas due dates are timed events; all-day ones have no specific time.
        time: e.allDay ? null : `${String(Math.floor(e.start / 60)).padStart(2, "0")}:${String(e.start % 60).padStart(2, "0")}`,
        title,
        course: c.name || course,
        period: c.period,
      });
    }
  }

  assignments.sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
  return { classes, otherCourses: [...otherCourses], assignments: assignments.slice(0, 200) };
}

module.exports = { readCanvasFeed, parseCourse, splitSummary, ALLOWED_FEED };
