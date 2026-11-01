import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GameEngine,
  GameRuleError,
  PHASE_LABEL,
  createCard,
  createManualClock,
  type HeroSkill,
  type Phase,
} from "../src/index.js";

function strike(id: string) {
  return createCard("strike", { id, suit: "spade", rank: 7 });
}

function dodge(id: string) {
  return createCard("dodge", { id, suit: "diamond", rank: 2 });
}

function heal(id: string) {
  return createCard("heal", { id, suit: "heart", rank: 4 });
}

function startDuel(input: {
  handA?: ReturnType<typeof strike>[];
  handB?: ReturnType<typeof strike>[];
  hpA?: number;
  hpB?: number;
  maxHpA?: number;
  maxHpB?: number;
  skillsA?: HeroSkill[];
  skillsB?: HeroSkill[];
  deck?: ReturnType<typeof strike>[];
  startAt?: Phase;
  players?: Array<{ id: string; name: string; hand?: ReturnType<typeof strike>[] }>;
}) {
  const engine = GameEngine.create({
    players: input.players ?? [
      {
        id: "A",
        name: "玩家A",
        hp: input.hpA,
        maxHp: input.maxHpA,
        hand: input.handA ?? [],
        skills: input.skillsA,
      },
      {
        id: "B",
        name: "玩家B",
        hp: input.hpB,
        maxHp: input.maxHpB,
        hand: input.handB ?? [],
        skills: input.skillsB,
      },
    ],
    deck: input.deck ?? [],
    startAt: input.startAt ?? "play",
    shuffle: false,
    clock: createManualClock(),
  });
  engine.start();
  return engine;
}

function player(engine: GameEngine, id: string) {
  const found = engine.getState().players.find((item) => item.id === id);
  assert.ok(found, `找不到玩家 ${id}`);
  return found;
}

describe("回合阶段", () => {
  it("六个阶段按顺序推进，出牌结束后进入下家", () => {
    const entered: string[] = [];
    const turns: string[] = [];
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "玩家A" },
        { id: "B", name: "玩家B" },
      ],
      deck: [strike("d1"), strike("d2"), strike("d3"), strike("d4")],
      shuffle: false,
    });
    engine.on("phase:enter", (event) => {
      entered.push(`${event.playerId}:${event.phase}`);
    });
    engine.on("turn:start", (event) => {
      turns.push(event.playerId);
    });
    engine.start();
    engine.endPlay("A");

    assert.deepEqual(Object.values(PHASE_LABEL), [
      "开始阶段",
      "判定阶段",
      "摸牌阶段",
      "出牌阶段",
      "弃牌阶段",
      "结束阶段",
    ]);
    assert.deepEqual(entered, [
      "A:start",
      "A:judge",
      "A:draw",
      "A:play",
      "A:discard",
      "A:end",
      "B:start",
      "B:judge",
      "B:draw",
      "B:play",
    ]);
    assert.deepEqual(turns, ["A", "B"]);
    assert.equal(player(engine, "A").hand.length, 2);
    assert.equal(player(engine, "B").hand.length, 2);
    assert.equal(engine.getState().pending?.kind, "play");
    assert.equal(engine.getState().phase, "play");
  });

  it("手牌超过体力时，弃牌阶段要弃到等于体力", () => {
    const engine = startDuel({
      hpA: 1,
      handA: [strike("s1"), strike("s2"), strike("s3")],
      deck: [strike("d1"), strike("d2")],
    });
    engine.endPlay("A");
    const pending = engine.getState().pending;
    assert.equal(pending?.kind, "discard");
    if (pending?.kind === "discard") {
      assert.equal(pending.playerId, "A");
      assert.equal(pending.count, 2);
    }
    engine.discard({ playerId: "A", cardIds: ["s1", "s2"] });
    assert.deepEqual(
      player(engine, "A").hand.map((card) => card.id),
      ["s3"],
    );
    assert.equal(engine.getState().players[engine.getState().currentPlayerIndex]?.id, "B");
    assert.equal(engine.getState().phase, "play");
  });
});

describe("杀、闪、桃", () => {
  it("A 出杀，B 出闪，结算后 B 不掉血", () => {
    const engine = startDuel({
      handA: [strike("s1")],
      handB: [dodge("d1"), heal("peach-b")],
    });
    const negated: string[] = [];
    let damageCount = 0;
    engine.on("strike:negated", (event) => {
      negated.push(`${event.strike.id}:${event.dodge.id}`);
    });
    engine.on("damage:dealt", () => {
      damageCount += 1;
    });

    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    const waiting = engine.getState().pending;
    assert.equal(waiting?.kind, "respond");
    if (waiting?.kind === "respond") {
      assert.equal(waiting.playerId, "B");
      assert.equal(waiting.reason, "dodge");
      assert.deepEqual(waiting.acceptTypes, ["dodge"]);
    }
    assert.equal(player(engine, "A").strikesUsedThisTurn, 1);
    assert.equal(player(engine, "A").hand.length, 0);

    engine.respond({ playerId: "B", cardId: "d1" });

    const state = engine.getState();
    assert.equal(damageCount, 0);
    assert.deepEqual(negated, ["s1:d1"]);
    assert.equal(player(engine, "B").hp, 4);
    assert.equal(player(engine, "B").hand.map((card) => card.id).join(","), "peach-b");
    assert.deepEqual(
      state.discardPile.map((card) => card.id),
      ["s1", "d1"],
    );
    assert.equal(state.processing.length, 0);
    assert.equal(state.phase, "play");
    assert.equal(state.pending?.kind, "play");
  });

  it("B 不出闪，受到 1 点伤害，闪还留在手里", () => {
    const engine = startDuel({
      handA: [strike("s1")],
      handB: [dodge("d1")],
    });
    const damages: Array<{ sourceId?: string; targetId: string; amount: number }> = [];
    engine.on("damage:dealt", (event) => {
      damages.push({
        sourceId: event.sourceId,
        targetId: event.targetId,
        amount: event.amount,
      });
    });

    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.respond({ playerId: "B" });

    assert.deepEqual(damages, [{ sourceId: "A", targetId: "B", amount: 1 }]);
    assert.equal(player(engine, "B").hp, 3);
    assert.deepEqual(
      player(engine, "B").hand.map((card) => card.id),
      ["d1"],
    );
    assert.deepEqual(
      engine.getState().discardPile.map((card) => card.id),
      ["s1"],
    );
    assert.equal(engine.getState().pending?.kind, "play");
  });

  it("响应杀时不能出桃，桃还在手里，窗口仍在", () => {
    const engine = startDuel({
      handA: [strike("s1")],
      handB: [heal("peach-b")],
    });
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    assert.throws(
      () => engine.respond({ playerId: "B", cardId: "peach-b" }),
      (error: unknown) => error instanceof GameRuleError && error.code === "ILLEGAL_RESPONSE",
    );
    assert.deepEqual(
      player(engine, "B").hand.map((card) => card.id),
      ["peach-b"],
    );
    assert.equal(engine.getState().pending?.kind, "respond");
  });

  it("闪不能主动打出，同一回合第二张杀会被拒绝", () => {
    const engine = startDuel({
      handA: [strike("s1"), strike("s2"), dodge("d-a")],
      handB: [dodge("d1")],
    });
    assert.throws(
      () => engine.playCard({ playerId: "A", cardId: "d-a", targets: ["B"] }),
      (error: unknown) => error instanceof GameRuleError && error.code === "NOT_PROACTIVE",
    );
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.respond({ playerId: "B", cardId: "d1" });
    assert.throws(
      () => engine.playCard({ playerId: "A", cardId: "s2", targets: ["B"] }),
      (error: unknown) => error instanceof GameRuleError && error.code === "STRIKE_LIMIT",
    );
    assert.equal(player(engine, "A").hand.some((card) => card.id === "s2"), true);
  });

  it("监听 strikeLimit 后，同一回合可以出第二张杀", () => {
    const engine = startDuel({
      handA: [strike("s1"), strike("s2")],
      handB: [],
    });
    engine.on("strikeLimit:calc", (event) => {
      if (event.playerId === "A") event.limit = 2;
    });
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.respond({ playerId: "B" });
    engine.playCard({ playerId: "A", cardId: "s2", targets: ["B"] });
    const pending = engine.getState().pending;
    assert.equal(pending?.kind, "respond");
    if (pending?.kind === "respond") assert.equal(pending.sourceCardId, "s2");
    engine.respond({ playerId: "B" });
    assert.equal(player(engine, "B").hp, 2);
  });

  it("攻击范围外的角色不能成为杀的目标", () => {
    const engine = startDuel({
      players: [
        { id: "A", name: "玩家A", hand: [strike("s1")] },
        { id: "B", name: "玩家B" },
        { id: "C", name: "玩家C" },
        { id: "D", name: "玩家D" },
      ],
    });
    assert.equal(engine.getDistance("A", "C"), 2);
    assert.throws(
      () => engine.playCard({ playerId: "A", cardId: "s1", targets: ["C"] }),
      (error: unknown) => error instanceof GameRuleError && error.code === "OUT_OF_RANGE",
    );
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    assert.equal(engine.getState().pending?.kind, "respond");
  });

  it("出牌阶段打出桃，回复 1 点体力，满血后再出会被拒绝", () => {
    const engine = startDuel({
      hpA: 3,
      handA: [heal("peach-1"), heal("peach-2")],
    });
    engine.playCard({ playerId: "A", cardId: "peach-1" });
    assert.equal(player(engine, "A").hp, 4);
    assert.deepEqual(
      engine.getState().discardPile.map((card) => card.id),
      ["peach-1"],
    );
    assert.throws(
      () => engine.playCard({ playerId: "A", cardId: "peach-2" }),
      (error: unknown) => error instanceof GameRuleError && error.code === "HP_FULL",
    );
  });

  it("体力降到 0 时打出桃，救回后杀进入弃牌堆", () => {
    const engine = startDuel({
      hpB: 1,
      handA: [strike("s1")],
      handB: [heal("peach-b")],
    });
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.respond({ playerId: "B" });
    const dying = engine.getState().pending;
    assert.equal(dying?.kind, "respond");
    if (dying?.kind === "respond") {
      assert.equal(dying.reason, "dying");
      assert.equal(dying.playerId, "B");
      assert.deepEqual(dying.acceptTypes, ["heal"]);
    }
    assert.equal(player(engine, "B").hp, 0);

    engine.respond({ playerId: "B", cardId: "peach-b" });
    assert.equal(player(engine, "B").hp, 1);
    assert.equal(player(engine, "B").alive, true);
    assert.equal(engine.getState().over, false);
    assert.deepEqual(
      engine.getState().discardPile.map((card) => card.id),
      ["peach-b", "s1"],
    );
    assert.equal(engine.getState().pending?.kind, "play");
  });

  it("不出桃则阵亡，对局结束", () => {
    const engine = startDuel({
      hpB: 1,
      handA: [strike("s1")],
      handB: [strike("left")],
    });
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.resolveAction("B", null);
    assert.equal(engine.getState().interaction, "DYING");
    engine.resolveAction("B", null);
    assert.equal(engine.getState().action?.playerId, "A");
    engine.resolveAction("A", null);

    const state = engine.getState();
    assert.equal(player(engine, "B").alive, false);
    assert.equal(player(engine, "B").hand.length, 0);
    assert.equal(state.over, true);
    assert.deepEqual(state.winners, ["A"]);
    assert.equal(state.winReason, "last-alive");
    assert.equal(state.pending, null);
    assert.ok(state.discardPile.some((card) => card.id === "s1"));
    assert.ok(state.discardPile.some((card) => card.id === "left"));
  });

  it("牌堆抽空后，弃牌堆补回牌堆再摸", () => {
    const engine = startDuel({
      hpA: 3,
      handA: [heal("peach-1")],
      deck: [],
    });
    engine.playCard({ playerId: "A", cardId: "peach-1" });
    engine.endPlay("A");
    assert.equal(engine.getState().currentPlayerIndex, 1);
    assert.deepEqual(
      player(engine, "B").hand.map((card) => card.id),
      ["peach-1"],
    );
  });
});

describe("武将技能扩展", () => {
  it("伤害前监听可以把这次杀的伤害取消", () => {
    const barrier: HeroSkill = {
      id: "barrier",
      name: "护体",
      description: "受到伤害前，防止这次伤害。",
      install(hooks) {
        hooks.on("damage:before", (event) => {
          if (event.targetId === hooks.ownerId) event.prevented = true;
        });
      },
    };
    const engine = startDuel({
      handA: [strike("s1")],
      skillsB: [barrier],
    });
    let prevented = 0;
    engine.on("damage:prevented", () => {
      prevented += 1;
    });
    engine.playCard({ playerId: "A", cardId: "s1", targets: ["B"] });
    engine.respond({ playerId: "B" });
    assert.equal(prevented, 1);
    assert.equal(player(engine, "B").hp, 4);
    assert.deepEqual(
      engine.getState().discardPile.map((card) => card.id),
      ["s1"],
    );
  });

  it("出牌阶段可以发动主动技能摸牌", () => {
    let used = false;
    const peek: HeroSkill = {
      id: "peek",
      name: "窥牌",
      install(hooks) {
        hooks.on("skill:invoke", (event) => {
          if (event.skillId !== "peek" || event.playerId !== hooks.ownerId) return;
          event.handled = true;
          used = true;
          hooks.draw(1);
        });
      },
    };
    const engine = startDuel({
      skillsA: [peek],
      deck: [strike("top")],
    });
    engine.invokeSkill({ playerId: "A", skillId: "peek" });
    assert.equal(used, true);
    assert.equal(player(engine, "A").hand[0]?.id, "top");
    assert.equal(engine.getState().pending?.kind, "play");
  });

  it("回合开始时标记跳过摸牌，进入出牌阶段时手牌不变", () => {
    const fasting: HeroSkill = {
      id: "fasting",
      name: "绝食",
      install(hooks) {
        hooks.on("turn:start", (event) => {
          if (event.playerId === hooks.ownerId) hooks.skipPhase("draw");
        });
      },
    };
    const engine = GameEngine.create({
      players: [
        { id: "A", name: "玩家A", skills: [fasting], hand: [strike("keep")] },
        { id: "B", name: "玩家B" },
      ],
      deck: [strike("d1"), strike("d2")],
      shuffle: false,
    });
    const skipped: Phase[] = [];
    engine.on("phase:skipped", (event) => {
      skipped.push(event.phase);
    });
    engine.start();
    assert.deepEqual(skipped, ["draw"]);
    assert.deepEqual(
      player(engine, "A").hand.map((card) => card.id),
      ["keep"],
    );
    assert.equal(engine.getState().deck.length, 2);
  });
});
