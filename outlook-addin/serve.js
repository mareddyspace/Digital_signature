// Local HTTPS server for the add-in. Outlook only loads add-ins over HTTPS.
// Serves src/ and forwards /api/* and /verify to the SignGuard backend.
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const devCerts = require("office-addin-dev-certs");

const PORT = Number(process.env.PORT || 3000);
// The address Outlook loads the add-in from. Set SIGNGUARD_ADDIN_URL when hosting publicly
// (for example https://addin.example.com); /manifest.xml is then served with that address.
const PUBLIC_URL = (process.env.SIGNGUARD_ADDIN_URL || `https://localhost:${PORT}`).replace(/\/+$/, "");
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

// MSAL browser (nested app authentication). Classic Outlook's event runtime can't load modules or
// several files, so /launchevent.js is served as one script: MSAL, the add-in's origin, then the handlers.
function msalPath() {
  const candidates = [
    path.join(__dirname, "node_modules", "@azure", "msal-browser", "lib", "msal-browser.min.js"),
    path.join(__dirname, "..", "admin-web", "node_modules", "@azure", "msal-browser", "lib", "msal-browser.min.js"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function serveLaunchEvent(res) {
  const lib = msalPath();
  if (!lib) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end("MSAL library missing: run npm install in outlook-addin");
  }
  const body = [
    fs.readFileSync(lib, "utf8"),
    `var SIGNGUARD_ORIGIN = ${JSON.stringify(PUBLIC_URL)};`,
    fs.readFileSync(path.join(ROOT, "launchevent.js"), "utf8"),
  ].join("\n;\n");
  cors(res);
  res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
  res.end(body);
}

// Classic Outlook on Windows only lets event code sign in and call other origins when the add-in's
// host lists that script here. https://learn.microsoft.com/office/dev/add-ins/outlook/use-sso-in-event-based-activation
function serveWellKnown(res) {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ allowed: [`${PUBLIC_URL}/launchevent.js`] }));
}

function serveManifest(res) {
  const xml = fs.readFileSync(path.join(__dirname, "manifest.xml"), "utf8").split("https://localhost:3000").join(PUBLIC_URL);
  res.writeHead(200, { "Content-Type": TYPES[".xml"], "Content-Disposition": "attachment; filename=manifest.xml" });
  res.end(xml);
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
      const route = new URL(req.url, "https://x").pathname;
      if (route === "/launchevent.js") return serveLaunchEvent(res);
      if (route === "/.well-known/microsoft-officeaddins-allowed.json") return serveWellKnown(res);
      if (route === "/manifest.xml") return serveManifest(res);
      serveFile(req, res);
    })
    .listen(PORT, () => {
      console.log(`SignGuard add-in on https://localhost:${PORT} (public address ${PUBLIC_URL}) -> backend ${BACKEND.href}`);
      console.log(msalPath() ? `MSAL: ${msalPath()}` : "WARNING: MSAL library missing; run npm install");
    });
});
