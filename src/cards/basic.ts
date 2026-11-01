import { GameRuleError } from "../errors.js";
import type { PlayerState } from "../model/player.js";
import type { CardDefinition, PlayContext } from "./definition.js";
import { fail, pass } from "./definition.js";

function requireOtherTarget(
  ctx: PlayContext,
): PlayerState | { code: string; reason: string } {
  if (ctx.targets.length !== 1) {
    return { code: "NEED_TARGET", reason: "需要指定一名目标" };
  }
  const targetId = ctx.targets[0];
  if (!targetId || targetId === ctx.playerId) {
    return { code: "ILLEGAL_TARGET", reason: "不能指定自己" };
  }
  const target = ctx.state.players.find((player) => player.id === targetId);
  if (!target?.alive) {
    return { code: "ILLEGAL_TARGET", reason: "目标不在场上" };
  }
  return target;
}

function strikeDefinition(): CardDefinition {
  return {
    type: "strike",
    name: "杀",
    category: "basic",
    kind: "BASIC",
    target: "other",
    distanceLimit: null,
    useAttackRange: true,
    description:
      "出牌阶段，对攻击范围内的一名其他角色打出。目标可以出闪抵消，否则受到 1 点伤害。每回合有次数上限。",
    answers: ["strike"],
    canPlay(ctx) {
      const target = requireOtherTarget(ctx);
      if (!("hp" in target)) return fail(target.code, target.reason);
      const user = ctx.state.players.find((player) => player.id === ctx.playerId);
      if (!user) return fail("NO_PLAYER", "找不到出牌的人");
      if (user.strikesUsedThisTurn >= ctx.strikeLimit(ctx.playerId)) {
        return fail("STRIKE_LIMIT", "本回合杀的次数已用完");
      }
      if (ctx.distance(ctx.playerId, target.id) > ctx.attackRange(ctx.playerId)) {
        return fail("OUT_OF_RANGE", "目标不在攻击范围内");
      }
      return pass();
    },
    play(ctx, effect) {
      const targetId = ctx.targets[0];
      if (!targetId) {
        throw new GameRuleError("NEED_TARGET", "杀需要指定一名目标");
      }
      effect.markStrikeUsed(ctx.playerId);
      effect.requestResponse(
        {
          playerId: targetId,
          reason: "dodge",
          acceptTypes: effect.typesFor("dodge"),
          allowPass: true,
          sourcePlayerId: ctx.playerId,
          sourceCardId: ctx.card.id,
        },
        (response) => {
          const finish = () => effect.discardProcessed([ctx.card], "used");
          if (response) {
            if (response.type === "dodge") {
              effect.note(`${effect.name(targetId)} 打出了闪，抵消了这次杀`);
            }
            effect.emit("strike:negated", {
              sourceId: ctx.playerId,
              targetId,
              strike: ctx.card,
              dodge: response,
            });
            effect.discardProcessed([ctx.card, response], "used");
            return;
          }
          effect.dealDamage(
            {
              sourceId: ctx.playerId,
              targetId,
              amount: 1,
              nature: "normal",
              card: ctx.card,
              reason: "strike",
            },
            finish,
          );
        },
      );
    },
  };
}

function dodgeDefinition(): CardDefinition {
  return {
    type: "dodge",
    name: "闪",
    category: "basic",
    kind: "BASIC",
    target: "none",
    distanceLimit: null,
    description: "有角色对你出杀，或万箭齐发时可以打出，抵消这一次。",
    answers: ["dodge"],
    canPlay() {
      return fail("NOT_PROACTIVE", "闪不能主动打出");
    },
    play() {
      // 主动出牌会先被 canPlay 拒绝。
    },
  };
}

function healDefinition(): CardDefinition {
  return {
    type: "heal",
    name: "桃",
    category: "basic",
    kind: "BASIC",
    target: "self",
    distanceLimit: null,
    description:
      "出牌阶段对自己使用，回复 1 点体力。有角色濒死时，从该角色起每人可以打出，回复该角色 1 点体力。",
    answers: ["dying"],
    normalizeTargets(ctx) {
      return ctx.targets.length > 0 ? ctx.targets : [ctx.playerId];
    },
    canPlay(ctx) {
      if (ctx.targets.length !== 1) {
        return fail("NEED_TARGET", "桃只能指定一名角色");
      }
      if (ctx.targets[0] !== ctx.playerId) {
        return fail("ILLEGAL_TARGET", "桃只能对自己使用");
      }
      const user = ctx.state.players.find((player) => player.id === ctx.playerId);
      if (!user) return fail("NO_PLAYER", "找不到出牌的人");
      if (user.hp >= user.maxHp) return fail("HP_FULL", "体力已满");
      return pass();
    },
    play(ctx, effect) {
      effect.applyHeal({
        sourceId: ctx.playerId,
        targetId: ctx.playerId,
        amount: 1,
        card: ctx.card,
      });
      effect.discardProcessed([ctx.card], "used");
    },
    respond(ctx, effect) {
      if (ctx.reason !== "dying") return;
      const saved = ctx.dyingPlayerId ?? ctx.playerId;
      effect.note(`${effect.name(ctx.playerId)} 打出了桃，把 ${effect.name(saved)} 从濒死里救回`);
      effect.applyHeal({
        sourceId: ctx.playerId,
        targetId: ctx.dyingPlayerId ?? ctx.playerId,
        amount: 1,
        card: ctx.card,
      });
    },
  };
}

export function createBasicCards(): CardDefinition[] {
  return [strikeDefinition(), dodgeDefinition(), healDefinition()];
}
