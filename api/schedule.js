// api/schedule.js  ->  GET /api/schedule
// Vercel serverless function: downloads the official ʻIolani bell feed,
// cleans it up, and returns small JSON the app can use.
//
// How the data stays fresh (three layers of caching):
//   1. Vercel's CDN keeps our response for 10 minutes (s-maxage), and may serve
//      a slightly old copy while it fetches a new one in the background
//      (stale-while-revalidate). Thousands of students = still ~6 feed downloads/hour.
//   2. Inside a warm function, we remember the last result in memory for 10 minutes.
//   3. In the browser, the service worker keeps the last good copy for offline use.
// So a schedule change in Google Calendar shows up in IoBot within about 10 minutes.

const { parseICS, HONOLULU_OFFSET_MINUTES } = require("../lib/ics");
const { buildSchedule } = require("../lib/schedule");

// Feed A: "Bell Schedule with Periods". Set FEED_URL in Vercel to switch to the test feed.
const FEED_URL = process.env.FEED_URL ||
  "https://calendar.google.com/calendar/ical/iolani.org_ds7482aj4fh4uortauf8vuquso%40group.calendar.google.com/public/basic.ics";

const TEN_MINUTES = 10 * 60 * 1000;
let memory = null; // { data, fetchedAt }

/** Today's date in Honolulu as "YYYY-MM-DD". */
function honoluluToday() {
  return new Date(Date.now() + HONOLULU_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

async function loadSchedule() {
  if (memory && Date.now() - memory.fetchedAt < TEN_MINUTES) return memory.data;

  // The feed is ~5.8 MB. Give up after 25 s so a stuck download falls back to the
  // last good copy instead of hanging until Vercel stops the function.
  const response = await fetch(FEED_URL, { headers: { "User-Agent": "IoBot bell schedule" }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  const text = await response.text();

  const events = parseICS(text);
  const data = {
    ...buildSchedule(events, honoluluToday()),
    fetchedAt: new Date().toISOString(),
    source: FEED_URL.includes("ds7482aj") ? "Bell Schedule with Periods" : "custom feed",
    totalEventsInFeed: events.length,
  };
  memory = { data, fetchedAt: Date.now() };
  return data;
}

module.exports = async (req, res) => {
  try {
    const data = await loadSchedule();
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).json(data);
  } catch (err) {
    // If Google is down but we have an older copy, serve that instead of failing.
    if (memory) {
      res.setHeader("Cache-Control", "public, s-maxage=60");
      return res.status(200).json({ ...memory.data, stale: true });
    }
    res.status(502).json({ error: "Could not load the bell schedule feed", detail: err.message });
  }
};
