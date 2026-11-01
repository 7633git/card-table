import type { GameEngine } from "../engine/game-engine.js";
import { isRed, type Card } from "../model/card.js";
import type { PlayerState, Role } from "../model/player.js";
import type { ClientCommand } from "./commands.js";

/**
 * 电脑的下一步。只读局面，不改引擎。
 * 没有该它行动的窗口时返回 null。
 * 出牌时：残血先吃桃，再无中生有，再按身份对敌人出杀，否则结束出牌。
 */
export function chooseBotAction(engine: GameEngine, botId: string): ClientCommand | null {
  const state = engine.getState();
  if (state.over) return null;
  const bot = state.players.find((player) => player.id === botId);
  if (!bot?.alive) return null;

  const action = state.action;
  if (action?.playerId === botId) {
    return respond(engine, bot, action);
  }

  const pending = state.pending;
  if (pending?.kind === "discard" && pending.playerId === botId) {
    return { type: "discard", cardIds: discardIds(bot.hand, pending.count) };
  }

  if (pending?.kind === "play" && pending.playerId === botId && state.interaction === "idle") {
    return play(engine, bot, state.players);
  }

  return null;
}

function respond(
  engine: GameEngine,
  bot: PlayerState,
  action: NonNullable<ReturnType<GameEngine["getState"]>["action"]>,
): ClientCommand {
  const answers = new Set(engine.legalAnswers(bot.id));
  if (action.acceptTypes.includes("dodge")) {
    const dodge = bot.hand.find((card) => card.type === "dodge" && answers.has(card.id));
    return { type: "resolve", cardId: dodge?.id ?? null };
  }
  if (action.interaction === "DYING") {
    const dying = engine.getState().players.find((player) => player.id === action.dyingPlayerId);
    if (!dying || !sameSide(bot, dying)) return { type: "resolve", cardId: null };
    const heal = bot.hand.find((card) => card.type === "heal" && answers.has(card.id));
    return { type: "resolve", cardId: heal?.id ?? null };
  }
  if (action.acceptTypes.includes("strike")) {
    const strike = bot.hand.find((card) => card.type === "strike" && answers.has(card.id));
    if (strike) return { type: "resolve", cardId: strike.id };
    const converted = [...bot.hand, ...equipped(bot)].find(
      (card) => card.type !== "strike" && isRed(card.suit) && answers.has(card.id) && card.type !== "heal",
    );
    return { type: "resolve", cardId: converted?.id ?? null };
  }
  const card = bot.hand.find((item) => answers.has(item.id));
  return { type: "resolve", cardId: card?.id ?? null };
}

function play(engine: GameEngine, bot: PlayerState, players: PlayerState[]): ClientCommand {
  const plays = engine.legalPlays(bot.id);
  if (bot.hp < bot.maxHp) {
    const heal = bot.hand.find((card) => card.type === "heal");
    if (heal && plays.some((item) => item.cardId === heal.id && !item.as)) {
      return { type: "play", cardId: heal.id, targets: [] };
    }
  }
  const exNihilo = bot.hand.find((card) => card.type === "ex-nihilo");
  if (exNihilo && plays.some((item) => item.cardId === exNihilo.id && !item.as)) {
    return { type: "play", cardId: exNihilo.id, targets: [] };
  }

  const enemyIds = new Set(enemies(bot, players).map((player) => player.id));
  const strike = plays.find((item) => {
    const card = bot.hand.find((hand) => hand.id === item.cardId);
    return card?.type === "strike" && !item.as && item.targets.some((id) => enemyIds.has(id));
  });
  if (strike) {
    const target = strike.targets.find((id) => enemyIds.has(id));
    if (target) return { type: "play", cardId: strike.cardId, targets: [target] };
  }

  const converted = plays.find(
    (item) => item.as === "strike" && item.targets.some((id) => enemyIds.has(id)) && !isHeal(bot, item.cardId),
  );
  if (converted) {
    const target = converted.targets.find((id) => enemyIds.has(id));
    if (target) return { type: "play", cardId: converted.cardId, targets: [target], as: "strike" };
  }

  if (bot.skillIds.includes("zhiheng") && !bot.usedSkills.includes("zhiheng") && bot.hand.length > bot.hp) {
    return {
      type: "invokeSkill",
      skillId: "zhiheng",
      payload: { cardIds: discardIds(bot.hand, bot.hand.length - bot.hp) },
    };
  }
  return { type: "endPlay" };
}

/** 反贼只打主公。主公和忠臣先打反贼。内奸先打反贼，没有反贼再打主公。 */
function enemies(bot: PlayerState, players: PlayerState[]): PlayerState[] {
  const others = players.filter((player) => player.alive && player.id !== bot.id);
  if (bot.role === "rebel") {
    const lords = others.filter((player) => player.role === "lord");
    return lords.length > 0 ? lords : others;
  }
  if (bot.role === "lord" || bot.role === "loyalist") {
    const rebels = others.filter((player) => player.role === "rebel");
    if (rebels.length > 0) return rebels;
    return others.filter((player) => player.role === "spy");
  }
  if (bot.role === "spy") {
    const rebels = others.filter((player) => player.role === "rebel");
    if (rebels.length > 0) return rebels;
    return others.filter((player) => player.role === "lord");
  }
  return others;
}

function sameSide(self: PlayerState, other: PlayerState): boolean {
  if (self.id === other.id) return true;
  const pair = (left: Role, right: Role) =>
    (self.role === left && other.role === right) || (self.role === right && other.role === left);
  if (self.role === "rebel" && other.role === "rebel") return true;
  return pair("lord", "loyalist") || (self.role === "loyalist" && other.role === "loyalist");
}

function equipped(player: PlayerState): Card[] {
  return Object.values(player.equipment).filter((card): card is Card => card !== undefined);
}

function isHeal(player: PlayerState, cardId: string): boolean {
  return [...player.hand, ...equipped(player)].some((card) => card.id === cardId && card.type === "heal");
}

function discardIds(hand: Card[], count: number): string[] {
  const pool = [...hand];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = pool[index];
    const other = pool[swap];
    if (!current || !other) continue;
    pool[index] = other;
    pool[swap] = current;
  }
  return pool.slice(0, count).map((card) => card.id);
}
