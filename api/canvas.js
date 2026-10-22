// api/canvas.js  ->  POST /api/canvas   body: { "url": "<Canvas calendar feed link>" }
//
// Why does the browser need us for this? Canvas doesn't allow other websites
// to download its calendar feed directly from the browser (CORS), so this
// function fetches it on the student's behalf and returns clean JSON.
//
// Privacy rules this function follows:
//   - The link arrives in the POST body, not the URL, so it never shows up in logs.
//   - Only ʻIolani Canvas feed links are accepted.
//   - Nothing is saved. The response is marked "no-store" so no cache keeps it.
//   - The link itself is stored only on the student's own device.

const { readCanvasFeed, ALLOWED_FEED } = require("../lib/canvas");
const { HONOLULU_OFFSET_MINUTES } = require("../lib/ics");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const url = (req.body && req.body.url || "").trim();
  if (!ALLOWED_FEED.test(url)) {
    return res.status(400).json({ error: "That doesn't look like an ʻIolani Canvas calendar feed link." });
  }

  try {
    const response = await fetch(url, { headers: { "User-Agent": "IoBot" }, signal: AbortSignal.timeout(8000) }); // give up after 8 s
    if (!response.ok) throw new Error(`Canvas returned HTTP ${response.status}`);
    const today = new Date(Date.now() + HONOLULU_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
    res.status(200).json(readCanvasFeed(await response.text(), today));
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach Canvas. Try again in a minute.", detail: err.message });
  }
};
