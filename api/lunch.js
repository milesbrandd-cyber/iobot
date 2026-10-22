// api/lunch.js  ->  GET /api/lunch
// Downloads the Weekly and Daily Bulletin PDFs from iolani.org, reads the text,
// and returns the lunch specials for each day we can find.
//
// The Weekly Bulletin covers Mon-Sun, so students can check lunch for any day
// this week. The Daily Bulletin is posted each evening; if it has today's lunch,
// it wins, because it is the newest information.
//
// If the PDFs are missing or change format, this returns an empty list and the
// app simply hides the lunch card. The bell schedule never depends on this.

const { findLunches } = require("../lib/lunch");

const PDFS = {
  weekly: "https://www.iolani.org/uploaded/PDF/Weekly_Bulletin.pdf",
  daily: "https://www.iolani.org/uploaded/PDF/DAILY_BULLETIN.pdf",
};

const THIRTY_MINUTES = 30 * 60 * 1000;
let memory = null;

/** Download a PDF and return all of its text. */
async function pdfText(url) {
  // unpdf is an ES module, so we load it with import() from this CommonJS file.
  const { getDocumentProxy, extractText } = await import("unpdf");
  const response = await fetch(url, { headers: { "User-Agent": "IoBot" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function loadLunches() {
  if (memory && Date.now() - memory.fetchedAt < THIRTY_MINUTES) return memory.data;

  // Download both PDFs at the same time. allSettled = one failing doesn't stop the other.
  const [weekly, daily] = await Promise.allSettled([pdfText(PDFS.weekly), pdfText(PDFS.daily)]);
  const days = {
    ...(weekly.status === "fulfilled" ? findLunches(weekly.value) : {}),
    ...(daily.status === "fulfilled" ? findLunches(daily.value) : {}), // daily overrides weekly
  };
  const data = { days, fetchedAt: new Date().toISOString(), source: "ʻIolani Daily & Weekly Bulletin" };
  memory = { data, fetchedAt: Date.now() };
  return data;
}

module.exports = async (req, res) => {
  try {
    const data = await loadLunches();
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(data);
  } catch (err) {
    res.status(200).json({ days: {}, error: err.message });
  }
};
