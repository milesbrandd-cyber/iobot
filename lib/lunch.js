// lib/lunch.js
// Finds the lunch specials in the text of the ʻIolani Daily and Weekly Bulletin PDFs.
//
// The Weekly Bulletin looks like this (one block per day):
//   Wednesday, October 21, 2026 - F Schedule (7,8,5,6) | A Schedule (LS)
//   LUNCH SPECIALS: ASC Dining Hall: BBQ Pork, Teriyaki Pork Sandwich, Margherita Pizza
//   One Team Wagon: Gumbo w/Cornbread
//   Weinberg Snack Bar: Garlic Chicken
//   7:15 am-9:25 am  Marching Band ...      <- events start; lunch section is over
//
// The Daily Bulletin has the same three lines near the top, under
//   DAILY BULLETIN: Tuesday, October 20, 2026

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

// "Wednesday, October 21, 2026" anywhere in a line -> "2026-10-21"
const DATE_RE = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;

// A lunch line: "<Place>: <food>". Place names are short words, no digits.
const VENUE_RE = /^([A-Z][A-Za-z'ʻ .&]{2,40}?):\s*(.+)$/;

// Lines that start with a time ("7:15 am", "12:00 pm") are calendar events, not lunch.
const TIME_RE = /^\d{1,2}:\d{2}\s*(?:am|pm)/i;

function toISODate(monthName, day, year) {
  const m = MONTHS.indexOf(monthName.toLowerCase());
  if (m === -1) return null;
  return `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * text -> { "2026-10-21": [ { place: "ASC Dining Hall", food: "BBQ Pork, ..." }, ... ] }
 */
function findLunches(text) {
  const result = {};
  let date = null;       // which day we are reading
  let inLunch = false;   // are we inside a lunch section right now?

  for (let line of text.split("\n")) {
    line = line.replace(/\s+/g, " ").trim();
    if (!line) continue;

    // A day header starts a new day. "(cont.)" repeats the header on a new page.
    const d = line.match(DATE_RE);
    if (d && !/\(cont\.?\)/i.test(line)) {
      date = toISODate(d[1], d[2], d[3]);
      // The Daily Bulletin lists lunch right under its header without a "LUNCH SPECIALS" label.
      inLunch = /DAILY BULLETIN/i.test(line);
      continue;
    }
    if (!date) continue;

    if (/^LUNCH SPECIALS:/i.test(line)) {
      inLunch = true;
      line = line.replace(/^LUNCH SPECIALS:\s*/i, "");
    }
    if (!inLunch) continue;

    // Events, divider lines, or section titles end the lunch section.
    if (TIME_RE.test(line) || /^-{5,}/.test(line) || /TODAY'S SCHEDULE/i.test(line)) { inLunch = false; continue; }

    const v = line.match(VENUE_RE);
    if (v && !/SCHEDULE/i.test(v[1])) {
      (result[date] ||= []).push({ place: v[1].trim(), food: v[2].trim() });
    }
  }
  return result;
}

module.exports = { findLunches };
