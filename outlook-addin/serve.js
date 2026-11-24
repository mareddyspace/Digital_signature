// Local HTTPS server for the add-in. Outlook only loads add-ins over HTTPS.
// Serves src/ and forwards /api/* and /verify to the SignGuard backend.
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const devCerts = require("office-addin-dev-certs");

const PORT = Number(process.env.PORT || 3000);
const BACKEND = new URL(process.env.SIGNGUARD_BACKEND || "http://localhost:8000");
const ROOT = path.join(__dirname, "src");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".xml": "application/xml",
};

function cors(res) {
  // The classic-Outlook JavaScript runtime calls the API without a page origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Dev-User");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function proxy(req, res) {
  const upstream = http.request(
    {
      hostname: BACKEND.hostname,
      port: BACKEND.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: BACKEND.host },
    },
    (up) => {
      cors(res);
      const headers = { ...up.headers };
      delete headers["access-control-allow-origin"];
      res.writeHead(up.statusCode || 502, headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    cors(res);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "SignGuard backend is not running on " + BACKEND.href }));
  });
  req.pipe(upstream);
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "https://x").pathname);
  const file = path.normalize(path.join(ROOT, urlPath === "/" ? "taskpane.html" : urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    cors(res);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

devCerts.getHttpsServerOptions().then((options) => {
  https
    .createServer(options, (req, res) => {
      if (req.method === "OPTIONS") {
        cors(res);
        res.writeHead(204);
        return res.end();
      }
      if (req.url.startsWith("/api/") || req.url === "/verify") return proxy(req, res);
      serveFile(req, res);
    })
    .listen(PORT, () => console.log(`SignGuard add-in on https://localhost:${PORT} -> backend ${BACKEND.href}`));
});
