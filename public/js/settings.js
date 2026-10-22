// js/settings.js
// A student's personal settings, saved on their own device with localStorage.
// Nothing here is ever sent to a server except the Canvas link, and only to
// fetch the student's own calendar.

const KEY = "iobot.settings.v1";

const DEFAULTS = {
  grade: null,            // 7-12, used for "Do I have chapel today?"
  classes: {},            // { "3": { name: "AP Gov", room: "W-204", teacher: "..." } }
  coursePeriods: {},      // Canvas course -> period the student picked, e.g. { "AP Psychology-Jones": 4 }
  assignmentEdits: {},    // assignment id -> the student's changes: { title, note, date, done, hidden }
  canvasUrl: "",          // the student's private Canvas calendar feed link
  showAssignments: true,  // the on/off switch for due dates
  theme: "auto",          // "auto" follows the device; "light" or "dark" forces it
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    // Private browsing or blocked storage: the app still works, it just won't remember.
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

// Small cache helpers for API data, so the app opens instantly and works offline.
export function readCache(name) {
  try { return JSON.parse(localStorage.getItem("iobot.cache." + name)); } catch { return null; }
}
export function writeCache(name, value) {
  try { localStorage.setItem("iobot.cache." + name, JSON.stringify(value)); } catch { /* full or blocked */ }
}
