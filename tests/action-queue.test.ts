import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTION_TIMEOUT_MS,
  GameEngine,
  GameRuleError,
  createCard,
  createManualClock,
} from "../src/index.js";

function strike(id: string) {
  return createCard("strike", { id });
}

function dodge(id: string) {
  return createCard("dodge", { id });
}

function heal(id: string) {
  return createCard("heal", { id });
}

describe("行动请求队列", () => {
  it("出杀后进入 WAITING_RESPONSE，B 用 resolveAction 出闪", () => {
    const clock = createManualClock(1_000);
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "玩家A", hand: [strike("s1")] },
        { id: "B", name: "玩家B", hand: [dodge("d1")] },
      ],
      startAt: "play",
      shuffle: false,
      clock,
    });
    const requested: string[] = [];
    engine.on("action:requested", (action) => {
      requested.push(`${action.interaction}:${action.playerId}`);
    });
    engine.start();
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });

    const state = engine.getState();
    assert.equal(state.interaction, "WAITING_RESPONSE");
    assert.equal(state.action?.playerId, "B");
    assert.deepEqual(state.action?.acceptTypes, ["dodge"]);
    assert.equal(state.action?.timeoutMs, ACTION_TIMEOUT_MS);
    assert.equal(state.action?.timeoutMs, 15_000);
    assert.equal(state.action?.startedAt, 1_000);
    assert.equal(state.action?.expiresAt, 16_000);
    assert.equal(state.action?.remainingMs, 15_000);
    assert.deepEqual(requested, ["WAITING_RESPONSE:B"]);

    clock.advance(5_000);
    assert.equal(engine.getState().action?.remainingMs, 10_000);
    assert.equal(engine.getState().interaction, "WAITING_RESPONSE");

    engine.resolveAction("B", "d1");
    assert.equal(engine.getState().interaction, "idle");
    assert.equal(engine.getState().action, null);
    assert.equal(engine.getState().players.find((item) => item.id === "B")?.hp, 4);
    clock.advance(20_000);
    assert.equal(engine.getState().players.find((item) => item.id === "B")?.hp, 4);
  });

  it("别人不能替 B 出闪，倒计时结束则视为放弃", () => {
    const clock = createManualClock();
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "玩家A", hand: [strike("s1")] },
        { id: "B", name: "玩家B", hand: [dodge("d1"), heal("peach-b")] },
      ],
      startAt: "play",
      shuffle: false,
      clock,
    });
    const resolved: Array<{ cardId: string | null; timedOut: boolean }> = [];
    engine.on("action:resolved", (event) => {
      resolved.push({ cardId: event.cardId, timedOut: event.timedOut });
    });
    engine.start();
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });

    assert.throws(
      () => engine.resolveAction("A", "d1"),
      (error: unknown) => error instanceof GameRuleError && error.code === "NOT_RESPONSE_WINDOW",
    );
    assert.throws(
      () => engine.resolveAction("B", "peach-b"),
      (error: unknown) => error instanceof GameRuleError && error.code === "ILLEGAL_RESPONSE",
    );
    assert.equal(engine.getState().interaction, "WAITING_RESPONSE");

    clock.advance(ACTION_TIMEOUT_MS - 1);
    assert.equal(engine.getState().interaction, "WAITING_RESPONSE");
    clock.advance(1);

    const state = engine.getState();
    assert.equal(state.interaction, "idle");
    assert.equal(state.players.find((item) => item.id === "B")?.hp, 3);
    assert.deepEqual(
      state.players.find((item) => item.id === "B")?.hand.map((card) => card.id),
      ["d1", "peach-b"],
    );
    assert.deepEqual(resolved, [{ cardId: null, timedOut: true }]);
  });

  it("濒死时从该玩家起顺时针问所有人，下家可以出桃救回", () => {
    const clock = createManualClock();
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "玩家A", hand: [strike("s1")] },
        { id: "B", name: "玩家B", hp: 1, hand: [dodge("d1")] },
        { id: "C", name: "玩家C", hand: [heal("peach-c")] },
      ],
      startAt: "play",
      shuffle: false,
      clock,
    });
    const asked: string[] = [];
    engine.on("action:requested", (action) => {
      if (action.interaction === "DYING") {
        asked.push(`${action.playerId}:${action.followingPlayerIds.join(",")}`);
      }
    });
    engine.start();
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.resolveAction("B", null);

    assert.equal(engine.getState().interaction, "DYING");
    assert.equal(engine.getState().action?.dyingPlayerId, "B");
    assert.equal(engine.getState().action?.timeoutMs, 15_000);
    assert.deepEqual(asked, ["B:C,A"]);

    engine.resolveAction("B", null);
    assert.equal(engine.getState().action?.playerId, "C");
    assert.deepEqual(engine.getState().action?.followingPlayerIds, ["A"]);
    assert.deepEqual(asked, ["B:C,A", "C:A"]);

    engine.resolveAction("C", "peach-c");
    const state = engine.getState();
    assert.equal(state.interaction, "idle");
    assert.equal(state.over, false);
    assert.equal(state.players.find((item) => item.id === "B")?.hp, 1);
    assert.equal(state.players.find((item) => item.id === "B")?.alive, true);
    assert.equal(state.players.find((item) => item.id === "C")?.hp, 4);
    assert.deepEqual(asked, ["B:C,A", "C:A"]);
    assert.equal(state.pending?.kind, "play");
  });

  it("一圈都不出桃，超时也算放弃，最后阵亡", () => {
    const clock = createManualClock();
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "玩家A", hand: [strike("s1")] },
        { id: "B", name: "玩家B", hp: 1 },
        { id: "C", name: "玩家C" },
      ],
      startAt: "play",
      shuffle: false,
      clock,
    });
    engine.start();
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    clock.advance(ACTION_TIMEOUT_MS);
    assert.equal(engine.getState().interaction, "DYING");
    assert.equal(engine.getState().action?.playerId, "B");

    clock.advance(ACTION_TIMEOUT_MS);
    assert.equal(engine.getState().action?.playerId, "C");
    clock.advance(ACTION_TIMEOUT_MS);
    assert.equal(engine.getState().action?.playerId, "A");
    clock.advance(ACTION_TIMEOUT_MS);

    const state = engine.getState();
    assert.equal(state.over, false);
    assert.equal(state.interaction, "idle");
    assert.equal(state.action, null);
    assert.equal(state.pending?.kind, "play");
    assert.equal(state.players.find((item) => item.id === "B")?.alive, false);
    assert.equal(state.players.find((item) => item.id === "A")?.alive, true);
    assert.equal(state.players.find((item) => item.id === "C")?.alive, true);
  });
});
