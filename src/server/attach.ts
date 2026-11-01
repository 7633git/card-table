import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CardRoom, ROOM_NAME } from "./card-room.js";

const MAX_PAYLOAD = 64 * 1024;

export function createCardServer(): Server {
  const server = new Server({
    transport: new WebSocketTransport({ maxPayload: MAX_PAYLOAD }),
    greet: false,
  });
  registerCardRoom(server);
  return server;
}

/**
 * 挂到已经存在的 Node HTTP 服务上。
 * 不占用新端口：WebSocket 升级和 /matchmake 走这台服务器，其余请求仍交给原来的监听器。
 */
export async function attachCardServer(httpServer: HttpServer): Promise<Server> {
  const previous = httpServer.listeners("request").slice();
  if (previous.length > 0) httpServer.removeAllListeners("request");
  const transport = new WebSocketTransport({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
  });
  transport.attachToServer(httpServer);
  const server = new Server({ transport, greet: false });
  registerCardRoom(server);
  await server.serverless();
  if (previous.length === 0) return server;
  const cardListeners = httpServer.listeners("request").slice();
  httpServer.removeAllListeners("request");
  httpServer.on("request", (req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const listeners = isCardRoute(path) ? cardListeners : previous;
    for (const listener of listeners) listener.call(httpServer, req, res);
  });
  return server;
}

function isCardRoute(path: string): boolean {
  return path === "/__healthcheck" || path.startsWith("/matchmake");
}

const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const FILE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * 自己听一个端口。前端已经打包时，页面和 WebSocket 走同一个地址，
 * 隧道或云主机只转发这一个端口，朋友打开的网址就是牌局地址。
 */
export async function startCardServer(port = Number(process.env.PORT) || 2567): Promise<Server> {
  if (!existsSync(join(WEB_DIST, "index.html"))) {
    const server = createCardServer();
    await server.listen(port);
    return server;
  }

  const httpServer = createServer((req, res) => {
    serveWeb(req, res);
  });
  const server = await attachCardServer(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => resolve());
  });
  return server;
}

function serveWeb(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(404).end();
    return;
  }
  const pathname = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  const filePath = safeWebFile(pathname);
  if (!filePath) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { "content-type": FILE_TYPES[extname(filePath)] ?? "application/octet-stream" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
    return;
  }
  if (extname(pathname)) {
    res.writeHead(404).end();
    return;
  }
  const indexHtml = join(WEB_DIST, "index.html");
  res.writeHead(200, { "content-type": FILE_TYPES[".html"] });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(indexHtml).pipe(res);
}

function safeWebFile(pathname: string): string | null {
  const relative = (pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
  if (relative.split("/").includes("..")) return null;
  const filePath = join(WEB_DIST, relative);
  const root = WEB_DIST.endsWith(sep) ? WEB_DIST : WEB_DIST + sep;
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function registerCardRoom(server: Server) {
  server.define(ROOM_NAME, CardRoom, { seats: 2 }).filterBy(["seats"]);
}

/** 没有现成 HTTP 服务时，自己听一个端口。测试会传入 0，让系统分配端口。 */
export function listenAddress(server: Server): { port: number } {
  const address = server.transport.server?.address();
  if (!address || typeof address === "string") {
    throw new Error("卡牌服务还没绑到端口");
  }
  return { port: address.port };
}
