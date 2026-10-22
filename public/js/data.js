// js/data.js
// Loads data from our own API (which reads the official feeds).
// Pattern used everywhere: show the saved copy instantly, then fetch a fresh one.

import { readCache, writeCache } from "./settings.js";

async function getJSON(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("You're offline. Try again when you have Wi-Fi.");
  }
  // A server error page may not be JSON, so don't let that crash the app.
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Something went wrong (HTTP ${response.status}). Try again in a minute.`);
  return body;
}

/** Bell schedule. Returns { data, fromCache } and never throws if a saved copy exists. */
export async function loadSchedule() {
  try {
    const data = await getJSON("/api/schedule");
    writeCache("schedule", data);
    return { data, fromCache: false };
  } catch (err) {
    const saved = readCache("schedule");
    if (saved) return { data: saved, fromCache: true };
    throw err;
  }
}

/** Lunch specials. Missing lunch is never an error; the card just hides. */
export async function loadLunch() {
  try {
    const data = await getJSON("/api/lunch");
    writeCache("lunch", data);
    return data;
  } catch {
    return readCache("lunch") || { days: {} };
  }
}

/** The student's Canvas classes + assignments, via our /api/canvas proxy. */
export async function loadCanvas(url) {
  const data = await getJSON("/api/canvas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  writeCache("canvas", { ...data, fetchedAt: new Date().toISOString() });
  return data;
}

export function savedSchedule() { return readCache("schedule"); }
export function savedLunch() { return readCache("lunch"); }
export function savedCanvas() { return readCache("canvas"); }
