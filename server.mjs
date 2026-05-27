import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const port = Number.parseInt(process.env.PORT || "4173", 10);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".mp4", "video/mp4"],
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const pathname = decoded === "/" ? "/index.html" : decoded;
  const candidate = normalize(join(root, pathname));
  return candidate.startsWith(root) ? candidate : null;
}

createServer(async (request, response) => {
  const filePath = safePath(request.url || "/");

  if (!filePath) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const info = await stat(filePath);

    if (!info.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }

    const contentType = types.get(extname(filePath)) || "application/octet-stream";
    const range = request.headers.range;

    if (range && extname(filePath) === ".mp4") {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match && match[1] ? Number.parseInt(match[1], 10) : 0;
      const requestedEnd = match && match[2] ? Number.parseInt(match[2], 10) : info.size - 1;
      const end = Math.min(requestedEnd, info.size - 1);

      if (!match || start > end || start >= info.size) {
        response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
        response.end();
        return;
      }

      response.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": info.size,
      "Accept-Ranges": extname(filePath) === ".mp4" ? "bytes" : "none",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(port, () => {
  console.log(`Quiet Pixel Pet running at http://localhost:${port}`);
});
