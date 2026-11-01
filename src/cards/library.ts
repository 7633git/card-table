import { isRed } from "../model/card.js";
import type { Card } from "../model/card.js";
import type { CardDefinition, EffectApi, PlayContext } from "./definition.js";
import { fail, pass } from "./definition.js";

function otherAlive(ctx: PlayContext): { id: string } | { code: string; reason: string } {
  if (ctx.targets.length !== 1) return { code: "NEED_TARGET", reason: "需要指定一名目标" };
  const targetId = ctx.targets[0];
  if (!targetId || targetId === ctx.playerId) {
    return { code: "ILLEGAL_TARGET", reason: "不能指定自己" };
  }
  const target = ctx.state.players.find((player) => player.id === targetId);
  if (!target?.alive) return { code: "ILLEGAL_TARGET", reason: "目标不在场上" };
  return { id: target.id };
}

function playerCards(ctx: PlayContext, playerId: string): Card[] {
  const player = ctx.state.players.find((item) => item.id === playerId);
  if (!player) return [];
  return [
    ...player.hand,
    ...player.judgmentZone,
    ...Object.values(player.equipment).filter((card): card is Card => card !== undefined),
  ];
}

function within(ctx: PlayContext, targetId: string, limit: number | null): boolean {
  if (limit === null) return true;
  return ctx.distance(ctx.playerId, targetId) <= limit;
}

function finishCard(card: Card, api: EffectApi): void {
  api.discardProcessed([card], "used");
}

function askOne(
  api: EffectApi,
  input: {
    playerId: string;
    reason: "strike" | "dodge";
    sourcePlayerId: string;
    sourceCardId: string;
  },
  done: (card: Card | null) => void,
): void {
  api.requestResponse(
    {
      playerId: input.playerId,
      reason: input.reason,
      acceptTypes: api.typesFor(input.reason),
      allowPass: true,
      sourcePlayerId: input.sourcePlayerId,
      sourceCardId: input.sourceCardId,
    },
    done,
  );
}

function askAround(
  ctx: PlayContext,
  api: EffectApi,
  reason: "strike" | "dodge",
  damageReason: string,
): void {
  const queue = api.clockwiseOthers(ctx.playerId);
  const step = (index: number) => {
    if (api.isOver()) return;
    const playerId = queue[index];
    if (!playerId) {
      finishCard(ctx.card, api);
      return;
    }
    askOne(
      api,
      {
        playerId,
        reason,
        sourcePlayerId: ctx.playerId,
        sourceCardId: ctx.card.id,
      },
      (response) => {
        if (response) {
          api.discardProcessed([response], "used");
          step(index + 1);
          return;
        }
        api.dealDamage(
          {
            sourceId: ctx.playerId,
            targetId: playerId,
            amount: 1,
            card: ctx.card,
            reason: damageReason,
          },
          () => step(index + 1),
        );
      },
    );
  };
  step(0);
}

function dismantle(): CardDefinition {
  return {
    type: "dismantle",
    name: "过河拆桥",
    category: "trick",
    kind: "SCROLL",
    target: "other",
    distanceLimit: null,
    description: "指定一名其他角色，随机弃置其一张手牌，或弃置你指定的装备、判定牌。",
    answers: [],
    canPlay(ctx) {
      const target = otherAlive(ctx);
      if (!("id" in target)) return fail(target.code, target.reason);
      const cards = playerCards(ctx, target.id);
      if (cards.length === 0) return fail("NOTHING_TO_DISCARD", "目标没有可弃的牌");
      if (ctx.pick && !cards.some((card) => card.id === ctx.pick)) {
        return fail("NO_SUCH_CARD", "目标没有这张牌");
      }
      if (!ctx.pick && !ctx.state.players.find((player) => player.id === target.id)?.hand.length) {
        return fail("NEED_PICK", "目标没有手牌，请指定装备或判定牌");
      }
      return pass();
    },
    play(ctx, api) {
      const targetId = ctx.targets[0];
      if (!targetId) return;
      const removed = ctx.pick
        ? api.discardOwned(targetId, ctx.pick)
        : api.discardRandomHand(targetId);
      if (removed) {
        api.note(
          ctx.pick
            ? `${api.name(ctx.playerId)} 拆掉了 ${api.name(targetId)} 的 ${removed.name}`
            : `${api.name(ctx.playerId)} 弃置了 ${api.name(targetId)} 的一张手牌`,
        );
      }
      finishCard(ctx.card, api);
    },
  };
}

function snatch(): CardDefinition {
  return {
    type: "snatch",
    name: "顺手牵羊",
    category: "trick",
    kind: "SCROLL",
    target: "other",
    distanceLimit: 1,
    description: "距离 1 以内的一名其他角色，拿走一张手牌或你指定的装备、判定牌。",
    answers: [],
    canPlay(ctx) {
      const target = otherAlive(ctx);
      if (!("id" in target)) return fail(target.code, target.reason);
      if (!within(ctx, target.id, 1)) return fail("OUT_OF_RANGE", "目标距离超过 1");
      const cards = playerCards(ctx, target.id);
      if (cards.length === 0) return fail("NOTHING_TO_TAKE", "目标没有可拿的牌");
      if (ctx.pick && !cards.some((card) => card.id === ctx.pick)) {
        return fail("NO_SUCH_CARD", "目标没有这张牌");
      }
      if (!ctx.pick && !ctx.state.players.find((player) => player.id === target.id)?.hand.length) {
        return fail("NEED_PICK", "目标没有手牌，请指定装备或判定牌");
      }
      return pass();
    },
    play(ctx, api) {
      const targetId = ctx.targets[0];
      if (!targetId) return;
      const taken = api.steal(targetId, ctx.playerId, ctx.pick ?? null);
      if (taken) {
        api.note(
          ctx.pick
            ? `${api.name(ctx.playerId)} 拿走了 ${api.name(targetId)} 的 ${taken.name}`
            : `${api.name(ctx.playerId)} 拿走了 ${api.name(targetId)} 的一张手牌`,
        );
      }
      finishCard(ctx.card, api);
    },
  };
}

function exNihilo(): CardDefinition {
  return {
    type: "ex-nihilo",
    name: "无中生有",
    category: "trick",
    kind: "SCROLL",
    target: "none",
    distanceLimit: null,
    description: "摸两张牌。",
    answers: [],
    canPlay() {
      return pass();
    },
    play(ctx, api) {
      const drawn = api.draw(ctx.playerId, 2);
      api.note(`${api.name(ctx.playerId)} 摸了 ${drawn.length} 张牌`);
      finishCard(ctx.card, api);
    },
  };
}

function duel(): CardDefinition {
  return {
    type: "duel",
    name: "决斗",
    category: "trick",
    kind: "SCROLL",
    target: "other",
    distanceLimit: null,
    description: "指定一名其他角色，由对方开始轮流出杀，先不出的人受到 1 点伤害。",
    answers: [],
    canPlay(ctx) {
      const target = otherAlive(ctx);
      if (!("id" in target)) return fail(target.code, target.reason);
      return pass();
    },
    play(ctx, api) {
      const targetId = ctx.targets[0];
      if (!targetId) return;
      const round = (responder: string, opponent: string) => {
        if (api.isOver()) return;
        askOne(
          api,
          {
            playerId: responder,
            reason: "strike",
            sourcePlayerId: ctx.playerId,
            sourceCardId: ctx.card.id,
          },
          (response) => {
            if (!response) {
              api.dealDamage(
                {
                  sourceId: opponent,
                  targetId: responder,
                  amount: 1,
                  card: ctx.card,
                  reason: "duel",
                },
                () => finishCard(ctx.card, api),
              );
              return;
            }
            api.discardProcessed([response], "used");
            round(opponent, responder);
          },
        );
      };
      round(targetId, ctx.playerId);
    },
  };
}

function barbarian(): CardDefinition {
  return {
    type: "barbarian",
    name: "南蛮入侵",
    category: "trick",
    kind: "SCROLL",
    target: "all",
    distanceLimit: null,
    description: "除你以外的所有角色须出杀，否则受到 1 点伤害。",
    answers: [],
    canPlay(ctx) {
      if (!ctx.state.players.some((player) => player.alive && player.id !== ctx.playerId)) {
        return fail("NO_TARGET", "没有其他角色");
      }
      return pass();
    },
    play(ctx, api) {
      askAround(ctx, api, "strike", "barbarian");
    },
  };
}

function arrows(): CardDefinition {
  return {
    type: "arrows",
    name: "万箭齐发",
    category: "trick",
    kind: "SCROLL",
    target: "all",
    distanceLimit: null,
    description: "除你以外的所有角色须出闪，否则受到 1 点伤害。",
    answers: [],
    canPlay(ctx) {
      if (!ctx.state.players.some((player) => player.alive && player.id !== ctx.playerId)) {
        return fail("NO_TARGET", "没有其他角色");
      }
      return pass();
    },
    play(ctx, api) {
      askAround(ctx, api, "dodge", "arrows");
    },
  };
}

function indulgence(): CardDefinition {
  return {
    type: "indulgence",
    name: "乐不思蜀",
    category: "delayed-trick",
    kind: "DELAYED_SCROLL",
    target: "other",
    distanceLimit: null,
    description: "放入目标的判定区。判定阶段若不是红桃，跳过其出牌阶段。",
    answers: [],
    canPlay(ctx) {
      const target = otherAlive(ctx);
      if (!("id" in target)) return fail(target.code, target.reason);
      const player = ctx.state.players.find((item) => item.id === target.id);
      if (player?.judgmentZone.some((card) => card.type === "indulgence")) {
        return fail("ALREADY_JUDGING", "目标判定区已有乐不思蜀");
      }
      return pass();
    },
    play(ctx, api) {
      const targetId = ctx.targets[0];
      if (!targetId) return;
      api.placeJudgment(targetId, ctx.card);
      api.note(`${api.name(ctx.playerId)} 把乐不思蜀放进了 ${api.name(targetId)} 的判定区`);
    },
    onJudge(ctx, api) {
      const heart = ctx.flip?.suit === "heart";
      api.note(
        heart
          ? `${api.name(ctx.playerId)} 的乐不思蜀判定为红桃，出牌阶段照常`
          : `${api.name(ctx.playerId)} 的乐不思蜀生效，跳过出牌阶段`,
      );
      if (!heart) api.skipPhase(ctx.playerId, "play");
    },
  };
}

function crossbow(): CardDefinition {
  return {
    type: "crossbow",
    name: "诸葛连弩",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: "weapon",
    description: "装备后，出牌阶段使用杀的次数不再受限。",
    answers: [],
    canPlay() {
      return pass();
    },
    play(ctx, api) {
      api.equip(ctx.playerId, ctx.card);
      api.note(`${api.name(ctx.playerId)} 装备了诸葛连弩`);
    },
    modifyStrikeLimit() {
      return Number.POSITIVE_INFINITY;
    },
  };
}

function bagua(): CardDefinition {
  return {
    type: "bagua",
    name: "八卦阵",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: "armor",
    description: "需要出闪时先判定。红色则视为打出闪，不消耗手牌。",
    answers: [],
    canPlay() {
      return pass();
    },
    play(ctx, api) {
      api.equip(ctx.playerId, ctx.card);
      api.note(`${api.name(ctx.playerId)} 装备了八卦阵`);
    },
    negateDodge(flip) {
      return isRed(flip.suit);
    },
  };
}

function horse(plus: boolean): CardDefinition {
  return {
    type: plus ? "horse-plus" : "horse-minus",
    name: plus ? "+1马" : "-1马",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: plus ? "horse-plus" : "horse-minus",
    description: plus
      ? "装备后，其他角色与你的距离 +1。"
      : "装备后，你与其他角色的距离 -1。",
    answers: [],
    canPlay() {
      return pass();
    },
    play(ctx, api) {
      api.equip(ctx.playerId, ctx.card);
      api.note(`${api.name(ctx.playerId)} 装备了 ${plus ? "+1马" : "-1马"}`);
    },
    modifyDistance({ role, distance }) {
      if (plus && role === "to") return distance + 1;
      if (!plus && role === "from") return distance - 1;
      return distance;
    },
  };
}

export function createLibraryCards(): CardDefinition[] {
  return [
    dismantle(),
    snatch(),
    exNihilo(),
    duel(),
    barbarian(),
    arrows(),
    indulgence(),
    crossbow(),
    bagua(),
    horse(true),
    horse(false),
  ];
}
