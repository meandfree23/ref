import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { liveSearch } from "./search-core.mjs";
import { readSourceDataset } from "./sources-core.mjs";
import { getLatestUpdates } from "./updates-core.mjs";
import { getLatestKoreanCodeUpdates, readKoreanCodeSeed } from "./korean-code-core.mjs";
import { getLatestCinemaUpdates } from "./cinema-core.mjs";
import { runDailyUpdate } from "./daily-update-core.mjs";
import { dailyResearchItemTarget } from "./research-policy.mjs";
import {
  readCinemaArchive,
  readKoreanCodeArchive,
  readUpdateArchive,
} from "./update-archive.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // The local archive is optional when no Vercel environment file exists.
}

const port = Number(process.env.PORT || 4173);
const root = path.join(process.cwd(), "public");
const staticTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendStatic(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": staticTypes.get(path.extname(filePath)) || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);

  try {
    if (url.pathname === "/api/status") {
      const dataset = readSourceDataset("expanded");
      sendJson(response, 200, {
        ok: true,
        bookmarkCount: dataset.counts.core,
        verifiedCount: dataset.counts.availableVerified,
        totalSourceCount: dataset.counts.total,
        folders: dataset.folders,
        updatedAt: dataset.generatedAt,
      });
      return;
    }

    if (url.pathname === "/api/search") {
      const query = url.searchParams.get("q") || "";
      const scope = url.searchParams.get("scope") || "expanded";
      const requestedMode = url.searchParams.get("mode");
      const mode = ["live", "visual"].includes(requestedMode) ? requestedMode : "quick";
      const payload = await liveSearch(query, { scope, mode });
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/updates") {
      const limit = Number(url.searchParams.get("limit") || dailyResearchItemTarget);
      const latest = await getLatestUpdates({ limit });
      const archive = await readUpdateArchive();
      sendJson(response, 200, {
        ...latest,
        latestItems: latest.items,
        items: archive.items.length ? archive.items : latest.items,
        archive,
      });
      return;
    }

    if (url.pathname === "/api/korean-code") {
      const limit = Number(url.searchParams.get("limit") || 30);
      const latest = await getLatestKoreanCodeUpdates({ limit });
      const archive = await readKoreanCodeArchive();
      const seed = readKoreanCodeSeed();
      sendJson(response, 200, {
        ...latest,
        latestItems: latest.items,
        items: archive.items.length ? archive.items : latest.items.length ? latest.items : seed.items,
        archive: archive.items.length
          ? archive
          : latest.items.length
            ? {
              enabled: archive.enabled,
              itemCount: latest.items.length,
              dateCount: 1,
              dates: [new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })],
              items: latest.items,
            }
            : {
              enabled: archive.enabled,
              itemCount: seed.items.length,
              dateCount: 1,
              dates: [seed.updatedAt],
              items: seed.items,
            },
        criteria: seed.scrapCriteria,
      });
      return;
    }

    if (url.pathname === "/api/cinema") {
      const limit = Number(url.searchParams.get("limit") || 30);
      const latest = await getLatestCinemaUpdates({ limit });
      const archive = await readCinemaArchive();
      sendJson(response, 200, {
        ...latest,
        latestItems: latest.items,
        items: archive.items.length ? archive.items : latest.items,
        archive: archive.items.length
          ? archive
          : {
            enabled: archive.enabled,
            itemCount: latest.items.length,
            dateCount: latest.items.length ? 1 : 0,
            dates: latest.items.length ? [new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })] : [],
            items: latest.items,
          },
      });
      return;
    }

    if (url.pathname === "/api/daily-update") {
      const target = Number(url.searchParams.get("target") || dailyResearchItemTarget);
      const limit = Number(url.searchParams.get("limit") || Math.max(80, target));
      sendJson(response, 200, await runDailyUpdate({ target, limit }));
      return;
    }

    sendStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Reference Selector running at http://localhost:${port}`);
});
