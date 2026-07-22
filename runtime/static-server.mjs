import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = path.resolve(args.get("--root") || process.cwd());
const port = Number(args.get("--port") || 0);
const entry = args.get("--entry") || "index.html";
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".wasm": "application/wasm"
};

function sendFile(filePath, response) {
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    let filePath = path.resolve(root, requestedPath || entry);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let fileStats = await stat(filePath).catch(() => null);
    if (fileStats?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStats = await stat(filePath).catch(() => null);
    }
    if (!fileStats?.isFile() && !path.extname(requestedPath)) {
      filePath = path.join(root, "index.html");
      fileStats = await stat(filePath).catch(() => null);
    }
    if (!fileStats?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    sendFile(filePath, response);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  console.log(`Static preview ready at http://127.0.0.1:${activePort}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
