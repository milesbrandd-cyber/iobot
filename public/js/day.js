// js/day.js
// The "brain" of IoBot. Pure functions: give them the schedule and a time,
// they return what to show. No HTML in here, which makes them easy to test.

import { toSeconds, addDays, dayOfWeek, daysBetween } from "./time.js";

/** "VETERANS DAY SCHOOL HOLIDAY" -> "Veterans Day" ; "FALL BREAK" -> "Fall Break" */
export function niceHoliday(label) {
  let s = label.replace(/\s*school\s+(holiday|holy day)/i, "").replace(/\(observed\)/i, "").trim();
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/'S\b/g, "'s");
  }
  return s.replace(/\bUs\b/, "US").replace(/\bLs\b/, "LS").replace(/\bJr\b/, "Jr") || "No school";
}

/** A friendly title for a day: "E Schedule", "Special Christmas Schedule", "No school" */
export function dayTitle(day) {
  if (!day) return null;
  if (day.type === "no-school") return niceHoliday(day.label);
  if (/chapel \(no chapel\)/i.test(day.label)) return "Chapel schedule (no chapel)";
  return day.label.replace(/\s*\([^)]*\)/g, "").trim(); // drop "(3,4,1,2)" and "(Grs...)"
}

/**
 * Chapel note for this student: "Grades 9 & 10 have chapel" / "You have chapel" / null.
 */
export function chapelInfo(day, grade) {
  if (!day || day.type === "no-school") return null;
  if (day.noChapel) return { mine: false, text: "No chapel today" };
  if (!day.chapelGrades || !day.chapelGrades.length) return null;
  const list = day.chapelGrades.join(" & ");
  const who = day.chapelGrades.length > 1 ? `Grades ${list}` : `Grade ${list}`;
  if (!grade) return { mine: null, text: `${who} chapel` };
  const mine = day.chapelGrades.includes(Number(grade));
  return { mine, text: mine ? `You have chapel (${who.toLowerCase()})` : `Homeroom for you. ${who} chapel` };
}

/**
 * Add the student's own info to each block:
 *   Period 3 -> title "AP Gov", subtitle "Period 3 · W-204"
 *   Homeroom/Chapel -> "Chapel" or "Homeroom" depending on grade
 */
export function personalBlocks(day, settings) {
  if (!day) return [];
  const chapel = chapelInfo(day, settings.grade);
  return day.blocks.map(b => {
    const out = { ...b, title: b.name, subtitle: null };
    if (b.kind === "period") {
      const cls = settings.classes[b.period];
      out.title = cls && cls.name ? cls.name : `Period ${b.period}`;
      out.subtitle = cls && cls.name ? [`Period ${b.period}`, cls.room || cls.teacher].filter(Boolean).join(", ") : null;
    } else if (b.kind === "homeroom" && /chapel/i.test(b.name) && chapel && chapel.mine !== null) {
      out.title = chapel.mine ? "Chapel" : "Homeroom";
    }
    return out;
  });
}

/**
 * What is happening right now?
 * Returns one of:
 *   { state: "before", next }                     before school
 *   { state: "in", current, next, left, progress } during a block
 *   { state: "passing", next, left }               between blocks
 *   { state: "after" }                              school is over
 */
export function nowStatus(blocks, seconds) {
  if (!blocks.length) return { state: "none" };
  const first = blocks[0];
  if (seconds < toSeconds(first.start)) {
    return { state: "before", next: first, left: toSeconds(first.start) - seconds };
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], start = toSeconds(b.start), end = toSeconds(b.end);
    if (seconds >= start && seconds < end) {
      return { state: "in", current: b, next: blocks[i + 1] || null, left: end - seconds,
               progress: (seconds - start) / (end - start), index: i };
    }
    const nextBlock = blocks[i + 1];
    if (nextBlock && seconds >= end && seconds < toSeconds(nextBlock.start)) {
      return { state: "passing", next: nextBlock, left: toSeconds(nextBlock.start) - seconds, index: i + 1 };
    }
  }
  return { state: "after" };
}

/** The next date (after `from`) that has classes. */
export function nextSchoolDay(days, from) {
  for (let i = 1; i <= 60; i++) {
    const d = addDays(from, i);
    if (days[d] && days[d].type !== "no-school") return d;
  }
  return null;
}

/**
 * The next weekday off (holiday or break) after today, so we can show
 * "Veterans Day in 22 days". Multi-day breaks report their first day and length.
 */
export function nextDayOff(days, from) {
  for (let i = 1; i <= 200; i++) {
    const d = addDays(from, i);
    const dow = dayOfWeek(d);
    if (dow === 0 || dow === 6) continue;
    const day = days[d];
    if (day && day.type === "no-school") {
      let length = 1, cursor = d;
      // Count how many school days in a row are off (skip weekends while counting).
      while (true) {
        let n = addDays(cursor, 1);
        while ([0, 6].includes(dayOfWeek(n))) n = addDays(n, 1);
        if (days[n] && days[n].type === "no-school") { length++; cursor = n; } else break;
      }
      return { date: d, name: niceHoliday(day.label), inDays: daysBetween(from, d), length };
    }
  }
  return null;
}

/**
 * Assignments due on a date. Each gets its class's period: the one the student
 * picked in Settings wins, otherwise whatever Canvas told us.
 */
export function assignmentsOn(canvas, date, coursePeriods = {}, edits = {}, mine = []) {
  const fromCanvas = ((canvas && canvas.assignments) || []).map(a => applyEdit(a, edits[a.id], coursePeriods));
  // Assignments the student added themselves (not on Canvas) sit alongside Canvas ones.
  const own = mine.map(m => ({ ...m, custom: true, canvasDate: m.date, canvasTitle: m.title, hidden: false, done: !!m.done }));
  return fromCanvas.concat(own)
    .filter(a => a.date === date && !a.hidden)
    .sort((a, b) => Number(a.done) - Number(b.done)); // finished work drops to the bottom
}

/**
 * A student's own changes to an assignment win over Canvas. Teachers don't always put
 * everything in Canvas ("handwritten", "bring a printed copy", "moved to Friday"),
 * so the student can add a note, rename it, move the due date, mark it done, or hide it.
 */
export function applyEdit(a, edit = {}, coursePeriods = {}) {
  return {
    ...a,
    canvasTitle: a.title,
    canvasDate: a.date,
    title: edit.title || a.title,
    date: edit.date || a.date,
    note: edit.note || "",
    done: !!edit.done,
    hidden: !!edit.hidden,
    edited: !!(edit.title || edit.date || edit.note),
    period: Number(coursePeriods[a.courseKey]) || a.period || null,
  };
}
