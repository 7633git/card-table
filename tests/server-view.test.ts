import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameEngine, createCard } from "../src/index.js";
import { applyCommand } from "../src/server/commands.js";
import { buildDeck, deal } from "../src/server/deck.js";
import { seatName } from "../src/server/card-room.js";
import { viewFor } from "../src/server/view.js";

describe("联机可见信息", () => {
  it("只把自己的手牌发给本人，牌堆顺序不出去", () => {
    const secret = createCard("strike", { id: "only-a" });
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [secret, createCard("dodge", { id: "a-dodge" })] },
        { id: "p2", name: "乙", hand: [createCard("heal", { id: "only-b" })] },
      ],
      deck: [createCard("strike", { id: "hidden-deck" })],
      startAt: "play",
      shuffle: false,
    });
    engine.start();
    const state = engine.getState();
    const seats = [
      { playerId: "p1", name: "甲", connected: true },
      { playerId: "p2", name: "乙", connected: false },
    ];
    const forA = viewFor(state, "p1", seats);
    const forB = viewFor(state, "p2", seats);

    assert.deepEqual(
      forA.players.find((player) => player.id === "p1")?.hand?.map((card) => card.id),
      ["only-a", "a-dodge"],
    );
    assert.equal(forB.players.find((player) => player.id === "p1")?.hand, null);
    assert.equal(forB.players.find((player) => player.id === "p1")?.handCount, 2);
    assert.equal(forA.players.find((player) => player.id === "p2")?.hand, null);
    assert.equal(JSON.stringify(forB).includes("only-a"), false);
    assert.equal(JSON.stringify(forB).includes("hidden-deck"), false);
    assert.equal(forB.deckCount, 1);
    assert.equal("deck" in forB, false);
    assert.equal(forA.players.find((player) => player.id === "p2")?.connected, false);
  });

  it("resolve 指令走引擎的响应队列", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [createCard("strike", { id: "s1" })] },
        { id: "p2", name: "乙", hand: [createCard("dodge", { id: "d1" })] },
      ],
      startAt: "play",
      shuffle: false,
    });
    engine.start();
    applyCommand(engine, "p1", { type: "play", cardId: "s1", targets: ["p2"] });
    assert.equal(engine.getState().interaction, "WAITING_RESPONSE");
    applyCommand(engine, "p2", { type: "resolve", cardId: "d1" });
    assert.equal(engine.getState().interaction, "idle");
    assert.equal(engine.getState().players[1]?.hp, 4);
  });
});

describe("房间牌堆", () => {
  it("按人数发 4 张，剩下的留在牌堆且没有重复", () => {
    const deck = buildDeck(2);
    const hands = deal(deck, 2, 4);
    const ids = [...hands.flat(), ...deck].map((card) => card.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(hands[0]?.length, 4);
    assert.equal(hands[1]?.length, 4);
    assert.equal(deck.length, buildDeck(2).length - 8);
  });

  it("空名字会落到座位号", () => {
    assert.equal(seatName("  ", 2), "玩家2");
    assert.equal(seatName("甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚", 1).length, 16);
  });
});
