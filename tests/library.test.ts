import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameEngine, createCard, createManualClock } from "../src/index.js";
import { buildDeck } from "../src/server/deck.js";

function playAt(handA: ReturnType<typeof createCard>[], handB: ReturnType<typeof createCard>[], deck: ReturnType<typeof createCard>[] = []) {
  const engine = GameEngine.create({
    players: [
      { id: "A", name: "甲", hand: handA },
      { id: "B", name: "乙", hand: handB },
    ],
    deck,
    startAt: "play",
    shuffle: false,
    clock: createManualClock(),
    rng: () => 0,
  });
  engine.start();
  return engine;
}

describe("锦囊和装备", () => {
  it("标准牌堆是 60 张且没有重复", () => {
    const deck = buildDeck(4);
    assert.equal(deck.length, 60);
    assert.equal(new Set(deck.map((card) => card.id)).size, 60);
    assert.ok(deck.some((card) => card.type === "dismantle"));
    assert.ok(deck.some((card) => card.type === "crossbow"));
  });

  it("过河拆桥随机弃掉目标的一张手牌", () => {
    const engine = playAt(
      [createCard("dismantle", { id: "bridge" })],
      [createCard("dodge", { id: "gone" }), createCard("strike", { id: "kept" })],
    );
    engine.playCard({ playerId: "A", cardId: "bridge", targets: ["B"] });
    const rival = engine.getState().players.find((player) => player.id === "B");
    assert.deepEqual(rival?.hand.map((card) => card.id), ["kept"]);
    assert.ok(engine.getState().discardPile.some((card) => card.id === "gone"));
  });

  it("无中生有摸两张，决斗由目标先出杀", () => {
    const draw = playAt(
      [createCard("ex-nihilo", { id: "gain" })],
      [],
      [createCard("strike", { id: "d1" }), createCard("dodge", { id: "d2" })],
    );
    draw.playCard({ playerId: "A", cardId: "gain", targets: [] });
    assert.deepEqual(
      draw.getState().players.find((player) => player.id === "A")?.hand.map((card) => card.id),
      ["d1", "d2"],
    );

    const duel = playAt(
      [createCard("duel", { id: "duel" })],
      [createCard("strike", { id: "answer" })],
    );
    duel.playCard({ playerId: "A", cardId: "duel", targets: ["B"] });
    assert.equal(duel.getState().action?.playerId, "B");
    assert.deepEqual(duel.getState().action?.acceptTypes, ["strike"]);
    duel.resolveAction("B", "answer");
    assert.equal(duel.getState().action?.playerId, "A");
    duel.resolveAction("A", null);
    assert.equal(duel.getState().players.find((player) => player.id === "A")?.hp, 3);
  });

  it("南蛮入侵不出杀就掉血，万箭齐发不出闪就掉血", () => {
    const south = playAt([createCard("barbarian", { id: "south" })], []);
    south.playCard({ playerId: "A", cardId: "south", targets: [] });
    assert.equal(south.getState().action?.acceptTypes.includes("strike"), true);
    south.resolveAction("B", null);
    assert.equal(south.getState().players.find((player) => player.id === "B")?.hp, 3);

    const rain = playAt([createCard("arrows", { id: "rain" })], [createCard("dodge", { id: "flash" })]);
    rain.playCard({ playerId: "A", cardId: "rain", targets: [] });
    rain.resolveAction("B", "flash");
    assert.equal(rain.getState().players.find((player) => player.id === "B")?.hp, 4);
    assert.equal(rain.getState().interaction, "idle");
  });

  it("乐不思蜀不是红桃就跳过出牌，诸葛连弩可以连出杀", () => {
    const skipped: string[] = [];
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "甲", hand: [createCard("indulgence", { id: "sleep" })] },
        { id: "B", name: "乙", hand: [] },
      ],
      deck: [createCard("strike", { id: "judge-black", suit: "spade", rank: 9 })],
      startAt: "play",
      shuffle: false,
      clock: createManualClock(),
    });
    engine.on("phase:skipped", (payload) => skipped.push(`${payload.playerId}:${payload.phase}`));
    engine.start();
    engine.playCard({ playerId: "A", cardId: "sleep", targets: ["B"] });
    engine.endPlay("A");
    assert.ok(skipped.includes("B:play"));

    const bow = playAt(
      [
        createCard("crossbow", { id: "bow" }),
        createCard("strike", { id: "s1" }),
        createCard("strike", { id: "s2" }),
      ],
      [],
    );
    bow.playCard({ playerId: "A", cardId: "bow", targets: [] });
    bow.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    bow.resolveAction("B", null);
    bow.playCard({ playerId: "A", cardId: "s2", targets: ["B"] });
    assert.equal(bow.getState().action?.playerId, "B");
  });

  it("八卦阵红判定抵消杀，+1 马把距离加到 1 以外", () => {
    const armor = GameEngine.create({
      players: [
        { id: "A", name: "甲", hand: [createCard("strike", { id: "s1" })] },
        { id: "B", name: "乙", hand: [createCard("bagua", { id: "armor" })] },
      ],
      deck: [
        createCard("dodge", { id: "pad-1" }),
        createCard("dodge", { id: "pad-2" }),
        createCard("heal", { id: "pad-3" }),
        createCard("heal", { id: "pad-4" }),
        createCard("strike", { id: "red", suit: "heart", rank: 2 }),
      ],
      startAt: "play",
      shuffle: false,
      clock: createManualClock(),
    });
    armor.start();
    armor.endPlay("A");
    armor.playCard({ playerId: "B", cardId: "armor", targets: [] });
    armor.endPlay("B");
    armor.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    const after = armor.getState();
    assert.equal(after.interaction, "idle");
    assert.equal(after.players.find((player) => player.id === "B")?.hp, 4);
    assert.ok(after.log.some((line) => line.includes("八卦阵")));

    const horse = playAt(
      [createCard("snatch", { id: "snatch" })],
      [createCard("horse-plus", { id: "plus" }), createCard("strike", { id: "loot" })],
    );
    horse.endPlay("A");
    horse.playCard({ playerId: "B", cardId: "plus", targets: [] });
    assert.equal(horse.getDistance("A", "B"), 2);
    horse.endPlay("B");
    assert.throws(() => horse.playCard({ playerId: "A", cardId: "snatch", targets: ["B"] }));
  });
});
