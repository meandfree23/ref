// Minimal dev server: static /public plus the /api/brief function.
//   GEMINI_API_KEY=... node scripts/dev-server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import briefHandler from "../api/brief.mjs";

const port = Number(process.env.PORT || 4174);
const publicDir = path.resolve("public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

function adapt(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  request.query = Object.fromEntries(url.searchParams.entries());
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (payload) => { response.setHeader("content-type", "application/json; charset=utf-8"); response.end(JSON.stringify(payload)); };
  return url;
}

http.createServer(async (request, response) => {
  const url = adapt(request, response);
  if (url.pathname === "/api/brief") {
    await briefHandler(request, response);
    return;
  }
  const file = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  response.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  response.setHeader("cache-control", "no-store");
  fs.createReadStream(file).pipe(response);
}).listen(port, () => console.log(`dev server http://localhost:${port}`));
