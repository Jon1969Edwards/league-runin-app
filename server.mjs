/**
 * Local dev server: static files + /api-football → https://api.football-data.org
 * football-data.org CORS only allows Origin "http://localhost" (default port).
 * Browsers send e.g. http://localhost:58888, which does not match, so direct fetch fails.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const envPortRaw = process.env.PORT;
const explicitPort =
  envPortRaw !== undefined && envPortRaw !== null && String(envPortRaw).trim() !== "";
const preferredPort = explicitPort ? Number(envPortRaw) : 58888;
if (explicitPort && !Number.isFinite(preferredPort)) {
  console.error(`Invalid PORT: ${envPortRaw}`);
  process.exit(1);
}
const PROXY_PREFIX = "/api-football";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] || "");
  const candidate = path.normalize(path.join(root, decoded === "/" ? "index.html" : decoded));
  if (!candidate.startsWith(root)) return null;
  return candidate;
}

function serveStatic(req, res, url) {
  const filePath = safeJoin(ROOT, url.pathname === "/" ? "/index.html" : url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  });
}

function proxyFootballData(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  const upstreamPath = url.pathname.slice(PROXY_PREFIX.length) + url.search;
  if (!upstreamPath.startsWith("/v4/")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const token = req.headers["x-auth-token"];
  if (!token || typeof token !== "string") {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Missing X-Auth-Token");
    return;
  }

  const opts = {
    protocol: "https:",
    hostname: "api.football-data.org",
    path: upstreamPath,
    method: req.method,
    headers: {
      "X-Auth-Token": token,
      "User-Agent": "league-runin-app-local-proxy",
      Accept: "application/json",
      "Accept-Encoding": "identity"
    }
  };

  const proxyReq = https.request(opts, (proxyRes) => {
    const outHeaders = { ...proxyRes.headers };
    delete outHeaders["transfer-encoding"];
    delete outHeaders["connection"];
    res.writeHead(proxyRes.statusCode || 502, outHeaders);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err.message || "Upstream error");
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400);
    res.end("Bad URL");
    return;
  }

  if (url.pathname === PROXY_PREFIX || url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
    proxyFootballData(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

function logListening() {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : preferredPort;
  console.log(`Run-in app: http://127.0.0.1:${port}/`);
  console.log(`           http://localhost:${port}/`);
}

function onBindError(err) {
  if (err.code === "EADDRINUSE") {
    if (explicitPort) {
      console.error(
        `Port ${preferredPort} is already in use. Stop the other process (or close that terminal), or run with a free port, e.g. set PORT=58889`
      );
      process.exit(1);
    }
    console.warn(`Port ${preferredPort} is already in use; starting on an available port instead.`);
    server.close(() => {
      server.once("error", (e2) => {
        console.error(e2);
        process.exit(1);
      });
      server.listen(0, "127.0.0.1");
    });
    return;
  }
  console.error(err);
  process.exit(1);
}

server.once("error", onBindError);
server.once("listening", () => {
  server.off("error", onBindError);
  logListening();
});
server.listen(preferredPort, "127.0.0.1");
