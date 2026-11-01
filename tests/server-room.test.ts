import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { describe, it } from "node:test";
import { Client, type Room } from "@colyseus/sdk";
import { attachCardServer, listenAddress } from "../src/server/attach.js";
import type { ClientView } from "../src/server/view.js";

function track(room: Room) {
  const queue: ClientView[] = [];
  const errors: string[] = [];
  let notify: (() => void) | null = null;
  const wake = () => {
    const current = notify;
    notify = null;
    current?.();
  };
  room.onMessage<ClientView>("state", (view) => {
    queue.push(view);
    wake();
  });
  room.onMessage<{ message?: string }>("error", (payload) => {
    errors.push(payload.message ?? "未知错误");
    wake();
  });
  return (match: (view: ClientView) => boolean, label: string) =>
    new Promise<ClientView>((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const check = () => {
        const index = queue.findIndex(match);
        if (index >= 0) {
          const view = queue[index];
          queue.splice(0, index + 1);
          assert.ok(view);
          resolve(view);
          return;
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          reject(new Error(`${label}。服务器错误：${errors.join("；") || "无"}`));
          return;
        }
        const timer = setTimeout(check, left);
        notify = () => {
          clearTimeout(timer);
          check();
        };
      };
      check();
    });
}

function listenOn(httpServer: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
}

describe("Colyseus 房间", () => {
  it("挂到现有 HTTP 服务后，只看得到自己的手牌，并且能把杀打出去", async () => {
    const httpServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
    });
    await listenOn(httpServer);
    const server = await attachCardServer(httpServer);
    const port = listenAddress(server).port;
    const endpoint = `http://127.0.0.1:${port}`;
    const alpha = new Client(endpoint);
    const beta = new Client(endpoint);
    let roomA: Room | undefined;
    let roomB: Room | undefined;
    try {
      const health = await fetch(`${endpoint}/`);
      assert.equal(await health.text(), "ok");
      roomA = await alpha.create("card", { seats: 2, name: "甲" });
      roomB = await beta.joinById(roomA.roomId, { name: "乙" });
      const nextA = track(roomA);
      const nextB = track(roomB);
      roomA.send("sync");
      roomB.send("sync");
      const viewA = await nextA((view) => view.phaseLabel === "出牌阶段", "等出牌阶段");
      const viewB = await nextB((view) => view.you === "p2", "等乙的局面");

      assert.equal(viewA.you, "p1");
      const own = viewA.players.find((player) => player.id === "p1");
      const hidden = viewB.players.find((player) => player.id === "p1");
      assert.ok(own?.hand && own.hand.length > 0);
      assert.equal(hidden?.hand, null);
      assert.equal(hidden?.handCount, own?.hand.length);
      const leaked = JSON.stringify(viewB);
      for (const card of own.hand) {
        assert.equal(leaked.includes(card.id), false);
      }
      assert.equal("deck" in viewA, false);

      const strike = own.hand.find((card) => card.type === "strike");
      assert.ok(strike, "起手应该有杀");
      roomA.send("play", { cardId: strike.id, targets: ["p2"] });
      const waiting = await nextB(
        (view) => view.interaction === "WAITING_RESPONSE",
        "等乙响应杀",
      );
      assert.equal(waiting.action?.playerId, "p2");
      assert.equal(waiting.action?.timeoutMs, 15_000);
      const hiddenStrike = JSON.stringify(
        waiting.players.find((player) => player.id === "p1")?.hand,
      );
      assert.equal(hiddenStrike.includes(strike.id), false);

      roomB.send("resolve", { cardId: null });
      const settled = await nextA(
        (view) => view.interaction === "idle" && view.players.some((player) => player.id === "p2" && player.hp === 3),
        "等结算",
      );
      const target = settled.players.find((player) => player.id === "p2");
      assert.equal(target?.hp, 3);
    } finally {
      await roomA?.leave();
      await roomB?.leave();
      await server.gracefullyShutdown(false);
      if (httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
    }
  });
});
