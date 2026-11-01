import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameEngine, createCard, createManualClock } from "../src/index.js";
import { chooseBotAction } from "../src/server/bot.js";
import { applyCommand } from "../src/server/commands.js";

function strike(id: string) {
  return createCard("strike", { id, suit: "spade", rank: 7 });
}

function dodge(id: string) {
  return createCard("dodge", { id, suit: "diamond", rank: 2 });
}

function heal(id: string) {
  return createCard("heal", { id, suit: "heart", rank: 4 });
}

function engineWith(handA: ReturnType<typeof strike>[], handB: ReturnType<typeof strike>[]) {
  const engine = GameEngine.create({
    players: [
      { id: "p1", name: "甲", hand: handA },
      { id: "p2", name: "对手", hand: handB },
    ],
    deck: [],
    startAt: "play",
    shuffle: false,
    clock: createManualClock(),
  });
  engine.start();
  return engine;
}

function runBot(engine: GameEngine) {
  for (let guard = 0; guard < 12; guard += 1) {
    const command = chooseBotAction(engine, "p2");
    if (!command) return;
    applyCommand(engine, "p2", command);
  }
  throw new Error("对手一直在行动");
}

describe("单机对手", () => {
  it("轮到自己时出杀，有闪就抵消", () => {
    const engine = engineWith([strike("s1")], [strike("s2"), dodge("d1")]);
    assert.equal(chooseBotAction(engine, "p2"), null);

    engine.playCard({ playerId: "p1", cardId: "s1", targets: ["p2"] });
    assert.deepEqual(chooseBotAction(engine, "p2"), { type: "resolve", cardId: "d1" });
    runBot(engine);
    assert.equal(engine.getState().players.find((player) => player.id === "p2")?.hp, 4);

    engine.endPlay("p1");
    runBot(engine);
    const state = engine.getState();
    assert.equal(state.interaction, "WAITING_RESPONSE");
    assert.equal(state.action?.playerId, "p1");
    assert.deepEqual(state.action?.acceptTypes, ["dodge"]);
  });

  it("没有闪就让杀打中", () => {
    const engine = engineWith([strike("s1")], [heal("h1")]);
    engine.playCard({ playerId: "p1", cardId: "s1", targets: ["p2"] });
    assert.deepEqual(chooseBotAction(engine, "p2"), { type: "resolve", cardId: null });
    runBot(engine);
    assert.equal(engine.getState().players.find((player) => player.id === "p2")?.hp, 3);
  });

  it("自己掉到 0 血时打出桃，别人濒死则不出", () => {
    const saved = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [strike("s1")] },
        { id: "p2", name: "对手", hp: 1, hand: [heal("h1")] },
      ],
      deck: [],
      startAt: "play",
      shuffle: false,
      clock: createManualClock(),
    });
    saved.start();
    saved.playCard({ playerId: "p1", cardId: "s1", targets: ["p2"] });
    assert.deepEqual(chooseBotAction(saved, "p2"), { type: "resolve", cardId: null });
    applyCommand(saved, "p2", { type: "resolve", cardId: null });
    assert.equal(saved.getState().action?.interaction, "DYING");
    assert.deepEqual(chooseBotAction(saved, "p2"), { type: "resolve", cardId: "h1" });
    runBot(saved);
    assert.equal(saved.getState().players.find((player) => player.id === "p2")?.hp, 1);

    const selfish = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hp: 1, hand: [] },
        { id: "p2", name: "对手", hand: [strike("s2"), heal("h2")] },
      ],
      deck: [],
      startAt: "play",
      shuffle: false,
      clock: createManualClock(),
    });
    selfish.start();
    selfish.endPlay("p1");
    runBot(selfish);
    selfish.resolveAction("p1", null);
    selfish.resolveAction("p1", null);
    const after = selfish.getState();
    assert.equal(after.action?.playerId, "p2");
    assert.equal(after.action?.dyingPlayerId, "p1");
    assert.deepEqual(chooseBotAction(selfish, "p2"), { type: "resolve", cardId: null });
  });

  it("手牌超限时先弃杀", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [] },
        {
          id: "p2",
          name: "对手",
          hp: 1,
          maxHp: 1,
          hand: [heal("h1"), dodge("d1"), strike("s1"), strike("s2")],
        },
      ],
      deck: [],
      startAt: "play",
      shuffle: false,
      clock: createManualClock(),
    });
    engine.start();
    engine.endPlay("p1");
    runBot(engine);
    engine.resolveAction("p1", null);
    assert.deepEqual(chooseBotAction(engine, "p2"), { type: "endPlay" });
    applyCommand(engine, "p2", { type: "endPlay" });
    const discard = chooseBotAction(engine, "p2");
    assert.equal(discard?.type, "discard");
    if (discard?.type === "discard") {
      assert.equal(discard.cardIds.length, 2);
      assert.equal(new Set(discard.cardIds).size, 2);
    }
  });
});
