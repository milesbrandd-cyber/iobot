// js/app.js
// Wires everything together: loads data, draws the page, updates the
// countdown every second, and handles taps.

import { honoluluNow, clock, countdown, addDays, dayOfWeek, weekMonday, formatDate, toSeconds } from "./time.js";
import { loadSettings, saveSettings } from "./settings.js";
import { loadSchedule, loadLunch, loadCanvas, savedSchedule, savedLunch, savedCanvas } from "./data.js";
import { dayTitle, chapelInfo, personalBlocks, nowStatus, nextSchoolDay, nextDayOff, assignmentsOn, niceHoliday } from "./day.js";

// ---------- App state ----------
const state = {
  settings: loadSettings(),
  schedule: savedSchedule(),   // start with the saved copy so the page draws instantly
  lunch: savedLunch(),
  canvas: savedCanvas(),
  offline: false,
  selected: honoluluNow().date,
};

const $ = id => document.getElementById(id);

/** Escape text before putting it into HTML (Canvas titles come from outside). */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const t = hhmm => { const c = clock(hhmm); return `${c.text}`; };
const today = () => honoluluNow().date;
const days = () => (state.schedule && state.schedule.days) || {};

// ---------- Theme ----------
function applyTheme() {
  const theme = state.settings.theme;
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

// ---------- Week strip ----------
function renderWeek() {
  const monday = weekMonday(state.selected);
  const html = [];
  for (let i = 0; i < 5; i++) {
    const date = addDays(monday, i);
    const day = days()[date];
    // Big letter for A-F days; a short word for everything else.
    const letter = day ? (day.variant || (day.type === "no-school" ? "Off" : "Special")) : "Off";
    const word = !day || !day.letter;
    html.push(`<button role="tab" data-date="${date}" aria-selected="${date === state.selected}"
      class="${word ? "off" : ""} ${date === today() ? "is-today" : ""}"
      aria-label="${formatDate(date, { weekday: "long", month: "long", day: "numeric" })}${day ? ", " + esc(dayTitle(day)) : ""}">
      <span class="wd">${formatDate(date, { weekday: "short" })} ${formatDate(date, { day: "numeric" })}</span>
      <span class="letter">${esc(letter)}</span></button>`);
  }
  $("week").innerHTML = html.join("");
}

// ---------- The Now card ----------
function renderNow() {
  const el = $("now");
  const day = days()[state.selected];
  const isToday = state.selected === today();
  el.classList.remove("quiet");
  el.style.setProperty("--progress", 0);

  if (!state.schedule) { el.innerHTML = `<p class="lead">Loading today's schedule…</p>`; return null; }

  const blocks = personalBlocks(day, state.settings);

  // A different day than today: show a summary instead of a countdown.
  if (!isToday) {
    el.classList.add("quiet");
    if (!day) { el.innerHTML = `<p class="lead">${formatDate(state.selected, { weekday: "long", month: "long", day: "numeric" })}</p><p class="big">No classes</p>`; return null; }
    const first = blocks[0], last = blocks[blocks.length - 1];
    el.innerHTML = `
      <div><p class="lead">${formatDate(state.selected, { weekday: "long", month: "long", day: "numeric" })}</p>
      <p class="big">${esc(dayTitle(day))}</p>
      ${first ? `<p class="sub">${t(first.start)} to ${t(last.end)}</p>` : ""}</div>
      ${day.letter ? `<p class="letterbig" aria-hidden="true">${esc(day.variant || day.letter)}</p>` : ""}`;
    return null;
  }

  // Today, but no classes (holiday, weekend, or a special day with no times).
  if (!day || day.type === "no-school" || day.type === "special-no-times") {
    el.classList.add("quiet");
    const nextDate = nextSchoolDay(days(), state.selected);
    const next = nextDate && days()[nextDate];
    const headline = !day ? ([0, 6].includes(dayOfWeek(state.selected)) ? "Weekend" : "No classes")
      : day.type === "no-school" ? niceHoliday(day.label) : dayTitle(day);
    const lead = day && day.type === "special-no-times" ? "Special schedule today. Times aren't in the bell calendar, so check the Daily Bulletin." : "No classes today";
    el.innerHTML = `<div><p class="lead">${esc(lead)}</p><p class="big">${esc(headline)}</p></div>
      ${next ? `<div class="next"><span>Next school day</span><b>${formatDate(nextDate, { weekday: "short", month: "short", day: "numeric" })}, ${esc(dayTitle(next))}</b></div>` : ""}`;
    return null;
  }

  const now = honoluluNow();
  const s = nowStatus(blocks, now.seconds);

  if (s.state === "in") {
    el.style.setProperty("--progress", s.progress.toFixed(4));
    el.innerHTML = `
      <div><p class="lead">Now, until ${t(s.current.end)}</p>
        <p class="big">${esc(s.current.title)}</p>
        ${s.current.subtitle ? `<p class="sub">${esc(s.current.subtitle)}</p>` : ""}</div>
      <p class="clock">${countdown(s.left)}<small>left</small></p>
      ${s.next ? `<div class="next"><span>Next at ${t(s.next.start)}</span><b>${esc(s.next.title)}</b></div>` : `<div class="next"><span>Last block of the day</span></div>`}`;
  } else if (s.state === "passing" || s.state === "before") {
    el.innerHTML = `
      <div><p class="lead">${s.state === "before" ? "School starts soon" : "Passing time"}</p>
        <p class="big">${esc(s.next.title)}</p>
        ${s.next.subtitle ? `<p class="sub">${esc(s.next.subtitle)}</p>` : ""}</div>
      <p class="clock">${countdown(s.left)}<small>until ${t(s.next.start)}</small></p>`;
  } else {
    el.classList.add("quiet");
    const nextDate = nextSchoolDay(days(), state.selected);
    const next = nextDate && days()[nextDate];
    el.innerHTML = `<div><p class="lead">Classes are done for today</p><p class="big">See you tomorrow</p></div>
      ${next ? `<div class="next"><span>${formatDate(nextDate, { weekday: "long" })}</span><b>${esc(dayTitle(next))}${next.blocks[0] ? `, starts ${t(next.blocks[0].start)}` : ""}</b></div>` : ""}`;
  }
  return s;
}

// ---------- Timeline ----------
let lastTimelineKey = "";
function renderTimeline(status) {
  const day = days()[state.selected];
  const blocks = personalBlocks(day, state.settings);
  const isToday = state.selected === today();
  const nowSec = honoluluNow().seconds;
  const due = state.settings.showAssignments ? assignmentsOn(state.canvas, state.selected) : [];

  // Only rebuild the list when something visible changed (not every second).
  const key = [state.selected, status && status.index, status && status.state, blocks.length, due.length, JSON.stringify(state.settings.classes), state.settings.grade].join("|");
  if (key === lastTimelineKey) return;
  lastTimelineKey = key;

  $("dayTitle").textContent = day ? dayTitle(day) : ([0, 6].includes(dayOfWeek(state.selected)) ? "Weekend" : "No classes");
  const chapel = chapelInfo(day, state.settings.grade);
  const order = day && day.order ? `Periods ${day.order.join(", ")}` : "";
  $("dayMeta").textContent = [formatDate(state.selected, { weekday: "long", month: "long", day: "numeric" }), order, chapel && chapel.text].filter(Boolean).join(". ");

  if (!blocks.length) {
    $("timeline").innerHTML = `<li class="empty">${day && day.type === "special-no-times" ? "The bell calendar lists this as a special day without block times." : "No classes on this day."}</li>`;
    return;
  }

  $("timeline").innerHTML = blocks.map((b, i) => {
    const minor = ["lunch", "break", "meeting"].includes(b.kind);
    const isCurrent = isToday && status && status.state === "in" && status.index === i;
    const isPast = isToday && nowSec >= toSeconds(b.end);
    const dueCount = b.kind === "period" ? due.filter(a => a.period === b.period).length : 0;
    return `<li class="${minor ? "minor" : ""} ${isCurrent ? "current" : ""} ${isPast && !isCurrent ? "past" : ""}" ${isCurrent ? 'aria-current="time"' : ""}>
      <span class="t">${t(b.start)}<span>${t(b.end)}</span></span>
      <span class="title">${esc(b.title)}${b.subtitle ? `<span class="subtitle">${esc(b.subtitle)}</span>` : ""}</span>
      ${dueCount ? `<span class="tag">${dueCount} due</span>` : ""}
    </li>`;
  }).join("");
}

// ---------- Lunch, due, day off, notices ----------
function renderSideCards() {
  const lunch = state.lunch && state.lunch.days && state.lunch.days[state.selected];
  $("lunchCard").hidden = !lunch || !lunch.length;
  if (lunch) $("lunchList").innerHTML = lunch.map(l => `<li><span class="place">${esc(l.place)}</span><span class="food">${esc(l.food)}</span></li>`).join("");

  const due = state.settings.showAssignments ? assignmentsOn(state.canvas, state.selected) : [];
  $("dueCard").hidden = !due.length;
  $("dueList").innerHTML = due.map(a => `<li><span class="what">${esc(a.title)}</span>
    <span class="course">${esc(a.course)}</span><span class="when">${a.time ? esc(clock(a.time).text + " " + clock(a.time).suffix) : "All day"}</span></li>`).join("");

  // Countdown to the next day off (only meaningful when looking at today).
  const off = state.selected === today() && state.schedule ? nextDayOff(days(), today()) : null;
  $("dayOff").hidden = !off;
  if (off) {
    const span = off.length > 1 ? `${off.name} (${off.length} days off)` : off.name;
    $("dayOff").innerHTML = off.inDays === 1 ? `No school tomorrow: <b>${esc(span)}</b>` : `Next day off: <b>${esc(span)}</b> in ${off.inDays} days`;
  }

  // Flag days whose schedule was edited recently, so students notice changes.
  const day = days()[state.selected];
  const changedRecently = day && day.changedAt && (Date.now() - Date.parse(day.changedAt)) < 14 * 86400000;
  $("notice").hidden = !changedRecently;
  if (changedRecently) {
    $("notice").textContent = `Heads up: the school updated this day's schedule on ${new Date(day.changedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "Pacific/Honolulu" })}.`;
  }
}

function renderHeader() {
  const isToday = state.selected === today();
  $("dateLabel").textContent = isToday ? "Today" : formatDate(state.selected, { weekday: "short", month: "short", day: "numeric" });
  $("datePicker").value = state.selected;
}

function renderFooter() {
  const el = $("updated");
  if (!state.schedule) return;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(state.schedule.fetchedAt)) / 60000));
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} hr ago`;
  el.className = state.offline ? "offline" : "live";
  el.textContent = state.offline ? `Offline. Showing the schedule saved ${ago}.` : `Live from the ʻIolani bell calendar, updated ${ago}`;
}

function render() {
  renderHeader();
  renderWeek();
  const status = renderNow();
  lastTimelineKey = "";
  renderTimeline(status);
  renderSideCards();
  renderFooter();
}

// ---------- Every second: update the countdown ----------
let lastDate = today();
setInterval(() => {
  if (today() !== lastDate) {           // midnight passed: move "today" forward
    if (state.selected === lastDate) state.selected = today();
    lastDate = today();
    render();
    return;
  }
  if (state.selected === today()) {
    const status = renderNow();
    renderTimeline(status);
  }
}, 1000);
setInterval(renderFooter, 30000);

// ---------- Loading and refreshing data ----------
async function refresh() {
  try {
    const { data, fromCache } = await loadSchedule();
    state.schedule = data; state.offline = fromCache;
  } catch {
    state.offline = true;
    if (!state.schedule) $("now").innerHTML = `<p class="lead">Can't reach the bell schedule. Check your Wi-Fi and reopen IoBot.</p>`;
  }
  render();
  state.lunch = await loadLunch();
  renderSideCards();
  refreshCanvas(false);
}

/** Pull classes and due dates from Canvas. `force` skips the 30-minute wait. */
async function refreshCanvas(force) {
  const url = state.settings.canvasUrl;
  if (!url) return;
  const age = state.canvas && state.canvas.fetchedAt ? Date.now() - Date.parse(state.canvas.fetchedAt) : Infinity;
  if (!force && age < 30 * 60000) return;
  try {
    const data = await loadCanvas(url);
    state.canvas = { ...data, fetchedAt: new Date().toISOString() };
    mergeCanvasClasses(data.classes);
    setCanvasStatus(describeCanvas(data), false);
    render();
  } catch (err) {
    setCanvasStatus(err.message, true);
  }
}

/** Canvas fills in class names; anything the student typed themselves wins. */
function mergeCanvasClasses(classes) {
  const mine = state.settings.classes;
  for (const [period, c] of Object.entries(classes || {})) {
    const existing = mine[period] || {};
    if (existing.source === "manual") continue;
    mine[period] = { name: c.name, teacher: c.teacher, room: existing.room || "", source: "canvas" };
  }
  saveSettings(state.settings);
}

function describeCanvas(data) {
  const n = Object.keys(data.classes || {}).length;
  const a = (data.assignments || []).length;
  return `Connected. Found ${n} class${n === 1 ? "" : "es"} and ${a} upcoming assignment${a === 1 ? "" : "s"}.`;
}
function setCanvasStatus(text, isError) {
  $("canvasStatus").textContent = text;
  $("canvasStatus").className = "status" + (isError ? " error" : "");
}

// Refresh when the student comes back to the app, and every 10 minutes while open.
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(refresh, 10 * 60000);

// ---------- Navigation ----------
function go(date) { state.selected = date; render(); }
function stepSchoolDay(direction) {
  let d = state.selected;
  do { d = addDays(d, direction); } while ([0, 6].includes(dayOfWeek(d)));
  go(d);
}
$("prevDay").onclick = () => stepSchoolDay(-1);
$("nextDay").onclick = () => stepSchoolDay(1);
$("todayBtn").onclick = () => go(today());
$("datePicker").onchange = e => { if (e.target.value) go(e.target.value); };
$("week").onclick = e => { const b = e.target.closest("button[data-date]"); if (b) go(b.dataset.date); };
// Arrow keys on a keyboard move between days too.
document.addEventListener("keydown", e => {
  if ($("settings").open || e.target.matches("input")) return;
  if (e.key === "ArrowLeft") stepSchoolDay(-1);
  if (e.key === "ArrowRight") stepSchoolDay(1);
});

// ---------- Settings sheet ----------
function renderSettings() {
  const s = state.settings;
  $("gradePick").innerHTML = [7, 8, 9, 10, 11, 12].map(g =>
    `<label><input type="radio" name="grade" value="${g}" ${Number(s.grade) === g ? "checked" : ""}><span>${g}</span></label>`).join("");
  $("canvasUrl").value = s.canvasUrl;
  $("showAssignments").checked = s.showAssignments;
  document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = r.value === s.theme; });
  $("classEditor").innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(p => {
    const c = s.classes[p] || {};
    return `<div class="class-row"><span class="p">${p}</span>
      <input type="text" data-period="${p}" data-field="name" value="${esc(c.name || "")}" placeholder="Period ${p}" aria-label="Period ${p} class name">
      <input type="text" data-period="${p}" data-field="room" value="${esc(c.room || "")}" placeholder="Room" aria-label="Period ${p} room"></div>`;
  }).join("");
  if (s.canvasUrl && state.canvas) setCanvasStatus(describeCanvas(state.canvas), false);
}

$("openSettings").onclick = () => { renderSettings(); $("settings").showModal(); };
$("settings").addEventListener("close", render);

$("gradePick").onchange = e => { state.settings.grade = Number(e.target.value); saveSettings(state.settings); };
$("themePick").onchange = e => { state.settings.theme = e.target.value; saveSettings(state.settings); applyTheme(); };
$("showAssignments").onchange = e => { state.settings.showAssignments = e.target.checked; saveSettings(state.settings); };
$("classEditor").oninput = e => {
  const { period, field } = e.target.dataset;
  const c = state.settings.classes[period] || {};
  c[field] = e.target.value;
  if (field === "name") c.source = "manual"; // the student's own edit beats Canvas
  state.settings.classes[period] = c;
  saveSettings(state.settings);
};
$("connectCanvas").onclick = async () => {
  const url = $("canvasUrl").value.trim();
  if (!url) {
    state.settings.canvasUrl = ""; state.canvas = null; saveSettings(state.settings);
    setCanvasStatus("Canvas disconnected.", false);
    return;
  }
  setCanvasStatus("Connecting to Canvas…", false);
  state.settings.canvasUrl = url;
  saveSettings(state.settings);
  await refreshCanvas(true);
  renderSettings();
};

// ---------- Start ----------
applyTheme();
render();
refresh();

// Offline support: register the service worker (see /sw.js).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
