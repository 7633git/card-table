import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameEngine, createCard, createHeroSkill, createManualClock, identityWin, openingVitals } from "../src/index.js";
import { GameRuleError } from "../src/errors.js";
import { chooseBotAction } from "../src/server/bot.js";
import { viewFor } from "../src/server/view.js";

function strike(id: string) {
  return createCard("strike", { id, suit: "spade", rank: 7 });
}

function clock() {
  return createManualClock();
}

function passAll(engine: GameEngine) {
  for (let guard = 0; guard < 16; guard += 1) {
    const state = engine.getState();
    if (state.over || !state.action) return;
    engine.resolveAction(state.action.playerId, null);
  }
}

describe("武将技能", () => {
  it("张飞咆哮可以连续出杀", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "张飞", skills: [createHeroSkill("paoxiao")], hand: [strike("s1"), strike("s2")] },
        { id: "p2", name: "乙", hand: [] },
      ],
      startAt: "play",
      clock: clock(),
    });
    engine.start();
    engine.playCard({ playerId: "p1", cardId: "s1", targets: ["p2"] });
    engine.resolveAction("p2", null);
    engine.playCard({ playerId: "p1", cardId: "s2", targets: ["p2"] });
    engine.resolveAction("p2", null);
    assert.equal(engine.getState().players.find((player) => player.id === "p2")?.hp, 2);
  });

  it("没有咆哮时第二张杀会被拒绝", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [strike("s1"), strike("s2")] },
        { id: "p2", name: "乙", hand: [] },
      ],
      startAt: "play",
      clock: clock(),
    });
    engine.start();
    engine.playCard({ playerId: "p1", cardId: "s1", targets: ["p2"] });
    engine.resolveAction("p2", null);
    assert.throws(() => engine.playCard({ playerId: "p1", cardId: "s2", targets: ["p2"] }), GameRuleError);
  });

  it("关羽可以把红色牌当杀使用或打出", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [createCard("barbarian", { id: "barb", suit: "club", rank: 5 })] },
        {
          id: "p2",
          name: "关羽",
          skills: [createHeroSkill("wusheng")],
          hand: [
            createCard("heal", { id: "peach", suit: "heart", rank: 3 }),
            createCard("crossbow", { id: "bow", suit: "diamond", rank: 1 }),
          ],
        },
      ],
      currentPlayerIndex: 1,
      startAt: "play",
      clock: clock(),
    });
    engine.start();
    engine.playCard({ playerId: "p2", cardId: "peach", targets: ["p1"], as: "strike" });
    engine.resolveAction("p1", null);
    assert.equal(engine.getState().players.find((player) => player.id === "p1")?.hp, 3);
    assert.equal(engine.getState().players.find((player) => player.id === "p2")?.hp, 4);

    engine.playCard({ playerId: "p2", cardId: "bow", targets: [] });
    engine.endPlay("p2");
    engine.playCard({ playerId: "p1", cardId: "barb", targets: [] });
    const bow = engine.getState().players.find((player) => player.id === "p2")?.equipment.weapon;
    assert.equal(bow?.id, "bow");
    engine.resolveAction("p2", "bow");
    assert.equal(engine.getState().players.find((player) => player.id === "p2")?.hp, 4);
    assert.equal(engine.getState().players.find((player) => player.id === "p2")?.equipment.weapon, undefined);
  });

  it("曹操受到伤害后获得那张牌", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "甲", hand: [strike("s1")] },
        { id: "p2", name: "曹操", skills: [createHeroSkill("jianxiong")], hand: [] },
      ],
      startAt: "play",
      clock: clock(),
    });
    engine.start();
    engine.playCard({ playerId: "p1", cardId: "s1", targets: ["p2"] });
    engine.resolveAction("p2", null);
    const cao = engine.getState().players.find((player) => player.id === "p2");
    assert.equal(cao?.hp, 3);
    assert.deepEqual(cao?.hand.map((card) => card.id), ["s1"]);
    assert.equal(engine.getState().log.some((line) => line.includes("奸雄")), true);
  });

  it("孙权制衡弃牌后摸等量的牌，一回合只能一次", () => {
    const engine = GameEngine.create({
      players: [
        { id: "p1", name: "孙权", skills: [createHeroSkill("zhiheng")], hand: [strike("a"), strike("b"), strike("c")] },
        { id: "p2", name: "乙", hand: [] },
      ],
      deck: [strike("d1"), strike("d2")],
      startAt: "play",
      shuffle: false,
      clock: clock(),
    });
    engine.start();
    engine.invokeSkill({ playerId: "p1", skillId: "zhiheng", payload: { cardIds: ["a", "b"] } });
    const quan = engine.getState().players.find((player) => player.id === "p1");
    assert.deepEqual(quan?.hand.map((card) => card.id), ["c", "d1", "d2"]);
    assert.throws(
      () => engine.invokeSkill({ playerId: "p1", skillId: "zhiheng", payload: { cardIds: ["c"] } }),
      GameRuleError,
    );
  });
});

describe("身份局", () => {
  it("主公体力上限加 1", () => {
    assert.deepEqual(openingVitals(4, "lord"), { hp: 5, maxHp: 5 });
    assert.deepEqual(openingVitals(4, "rebel"), { hp: 4, maxHp: 4 });
  });

  it("反贼和内奸都死后主忠获胜", () => {
    const engine = GameEngine.create({
      players: [
        { id: "rebel", name: "反", role: "rebel", hp: 1, maxHp: 1, hand: [] },
        { id: "lord", name: "主", role: "lord", skills: [createHeroSkill("paoxiao")], hand: [strike("s1"), strike("s2")] },
        { id: "spy", name: "内", role: "spy", hp: 1, maxHp: 1, hand: [] },
        { id: "loyal", name: "忠", role: "loyalist", hand: [] },
      ],
      currentPlayerIndex: 1,
      startAt: "play",
      clock: clock(),
      winChecker: identityWin,
    });
    engine.start();
    engine.playCard({ playerId: "lord", cardId: "s1", targets: ["rebel"] });
    passAll(engine);
    engine.playCard({ playerId: "lord", cardId: "s2", targets: ["spy"] });
    passAll(engine);
    const state = engine.getState();
    assert.equal(state.over, true);
    assert.equal(state.winReason, "lord-loyalist");
    assert.deepEqual(state.winners, ["lord", "loyal"]);
  });

  it("主公死亡且还有别人时反贼获胜", () => {
    const engine = GameEngine.create({
      players: [
        { id: "lord", name: "主", role: "lord", hp: 1, maxHp: 1, hand: [] },
        { id: "rebel", name: "反", role: "rebel", hand: [strike("s1")] },
        { id: "loyal", name: "忠", role: "loyalist", hand: [] },
        { id: "spy", name: "内", role: "spy", hand: [] },
      ],
      currentPlayerIndex: 1,
      startAt: "play",
      clock: clock(),
      winChecker: identityWin,
    });
    engine.start();
    engine.playCard({ playerId: "rebel", cardId: "s1", targets: ["lord"] });
    passAll(engine);
    const state = engine.getState();
    assert.equal(state.winReason, "rebel");
    assert.equal(state.players.find((player) => player.id === "loyal")?.alive, true);
  });

  it("只剩内奸一人时内奸获胜，别人的身份不外泄", () => {
    const engine = GameEngine.create({
      players: [
        { id: "rebel", name: "反", role: "rebel", hp: 1, maxHp: 1, hand: [] },
        {
          id: "spy",
          name: "内",
          role: "spy",
          skills: [createHeroSkill("paoxiao")],
          hand: [createCard("duel", { id: "duel", suit: "spade", rank: 1 }), strike("s1"), strike("s2")],
        },
        { id: "lord", name: "主", role: "lord", hp: 1, maxHp: 1, hand: [] },
        { id: "loyal", name: "忠", role: "loyalist", hp: 1, maxHp: 1, hand: [] },
      ],
      currentPlayerIndex: 1,
      startAt: "play",
      clock: clock(),
      winChecker: identityWin,
    });
    engine.start();
    const hidden = viewFor(engine.getState(), "loyal", [
      { playerId: "loyal", name: "忠", connected: true },
    ]);
    assert.equal(hidden.players.find((player) => player.id === "rebel")?.role, "hidden");
    assert.equal(hidden.players.find((player) => player.id === "lord")?.role, "lord");
    assert.equal(hidden.players.find((player) => player.id === "loyal")?.role, "loyalist");

    engine.playCard({ playerId: "spy", cardId: "duel", targets: ["loyal"] });
    passAll(engine);
    engine.playCard({ playerId: "spy", cardId: "s1", targets: ["rebel"] });
    passAll(engine);
    engine.playCard({ playerId: "spy", cardId: "s2", targets: ["lord"] });
    passAll(engine);
    const state = engine.getState();
    assert.equal(state.winReason, "spy");
    assert.deepEqual(state.winners, ["spy"]);
  });
});

describe("身份局电脑", () => {
  it("反贼只打主公，忠臣先打反贼", () => {
    const rebelTurn = GameEngine.create({
      players: [
        { id: "lord", name: "主", role: "lord", hand: [] },
        { id: "rebel", name: "Bot-反贼", role: "rebel", hand: [strike("s1")] },
        { id: "loyal", name: "忠", role: "loyalist", hand: [] },
        { id: "spy", name: "内", role: "spy", hand: [] },
      ],
      currentPlayerIndex: 1,
      startAt: "play",
      clock: clock(),
      winChecker: identityWin,
    });
    rebelTurn.start();
    assert.deepEqual(chooseBotAction(rebelTurn, "rebel"), { type: "play", cardId: "s1", targets: ["lord"] });

    const loyalTurn = GameEngine.create({
      players: [
        { id: "rebel", name: "Bot-反贼", role: "rebel", hand: [] },
        { id: "loyal", name: "Bot-忠臣", role: "loyalist", hand: [strike("s2")] },
        { id: "lord", name: "主", role: "lord", hand: [] },
        { id: "spy", name: "内", role: "spy", hand: [] },
      ],
      currentPlayerIndex: 1,
      startAt: "play",
      clock: clock(),
      winChecker: identityWin,
    });
    loyalTurn.start();
    assert.deepEqual(chooseBotAction(loyalTurn, "loyal"), { type: "play", cardId: "s2", targets: ["rebel"] });
  });
});
