// dev-server.js: run IoBot on your own computer with `node dev-server.js`.
// It serves the files in /public and runs the /api functions the same way Vercel does.
// (Vercel isn't needed for this; it's handy for testing in the AI Lab.)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// Add the small helpers Vercel gives every function: res.status() and res.json().
function vercelStyle(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const name = path.basename(url.pathname);
    const file = path.join(__dirname, "api", name + ".js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    return require(file)(req, vercelStyle(res));
  }

  let file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`IoBot running at http://localhost:${PORT}`));
