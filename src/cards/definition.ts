import type { Card, EquipSlot, TargetKind } from "../model/card.js";
import type { DamageNature, GameEventMap } from "../model/events.js";
import type { GameState } from "../model/game-state.js";
import type { Phase } from "../model/phase.js";
import type { RespondReason } from "../model/pending.js";

export type RuleCheck =
  | { ok: true }
  | { ok: false; code: string; reason: string };

export function pass(): RuleCheck {
  return { ok: true };
}

export function fail(code: string, reason: string): RuleCheck {
  return { ok: false, code, reason };
}

export interface PlayContext {
  playerId: string;
  card: Card;
  targets: string[];
  /** 过河拆桥、顺手牵羊指定的装备或判定牌。不传就从手牌里随机。 */
  pick?: string;
  state: GameState;
  distance(fromId: string, toId: string): number;
  attackRange(playerId: string): number;
  strikeLimit(playerId: string): number;
}

export interface JudgeContext {
  playerId: string;
  card: Card;
  flip: Card | null;
}

export interface RespondContext {
  playerId: string;
  card: Card;
  reason: RespondReason;
  state: GameState;
  sourcePlayerId?: string;
  sourceCardId?: string;
  /** 濒死结算里，这张桃要回复的人。 */
  dyingPlayerId?: string;
}

export interface DamageRequest {
  sourceId?: string;
  targetId: string;
  amount: number;
  nature?: DamageNature;
  card?: Card;
  reason: string;
}

export interface HealRequest {
  sourceId: string;
  targetId: string;
  amount: number;
  card?: Card;
}

export interface ResponseRequest {
  playerId: string;
  reason: RespondReason;
  acceptTypes: string[];
  allowPass: boolean;
  sourcePlayerId?: string;
  sourceCardId?: string;
  dyingPlayerId?: string;
  followingPlayerIds?: string[];
}

/**
 * 卡牌效果能使用的引擎能力。
 * 新卡牌只依赖这个接口，不依赖 GameEngine 类本身。
 */
export interface EffectApi {
  typesFor(reason: RespondReason): string[];
  requestResponse(
    request: ResponseRequest,
    onResolve: (card: Card | null) => void,
  ): void;
  dealDamage(request: DamageRequest, onSettled: () => void): void;
  applyHeal(request: HealRequest): void;
  discardProcessed(cards: Card[], reason: string): void;
  markStrikeUsed(playerId: string): void;
  draw(playerId: string, count: number): Card[];
  /** 从牌堆翻开一张判定牌，随即进入弃牌堆。牌堆空了返回 null。 */
  judgeFlip(playerId: string, sourceId?: string): Card | null;
  discardOwned(ownerId: string, cardId: string): Card | null;
  discardRandomHand(ownerId: string): Card | null;
  /** cardId 为空时随机抽一张手牌。抽到的牌进 toId 的手牌。 */
  steal(fromId: string, toId: string, cardId: string | null): Card | null;
  equip(playerId: string, card: Card): void;
  placeJudgment(targetId: string, card: Card): void;
  skipPhase(playerId: string, phase: Phase): void;
  livingOthers(playerId: string): string[];
  clockwiseOthers(playerId: string): string[];
  name(playerId: string): string;
  note(line: string): void;
  isOver(): boolean;
  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void;
}

export interface CardDefinition {
  type: string;
  name: string;
  category: Card["category"];
  kind: Card["kind"];
  target: TargetKind;
  distanceLimit: number | null;
  useAttackRange?: boolean;
  slot?: EquipSlot;
  description: string;
  /** 这张牌能回答哪类询问。杀回答 strike，闪回答 dodge，桃回答 dying。 */
  answers: RespondReason[];
  normalizeTargets?(ctx: PlayContext): string[];
  canPlay(ctx: PlayContext): RuleCheck;
  /** 打出时的结算。对应 onUse。 */
  play(ctx: PlayContext, api: EffectApi): void;
  canRespond?(ctx: RespondContext): boolean;
  /** 作为响应打出后的额外结算。询问方仍会收到这张牌。 */
  respond?(ctx: RespondContext, api: EffectApi): void;
  /** 延时锦囊在判定阶段翻开后的结算。对应 onResolve。 */
  onJudge?(ctx: JudgeContext, api: EffectApi): void;
  /** 装备在身上时改写出杀次数。 */
  modifyStrikeLimit?(limit: number): number;
  /** 装备在身上时改写距离。from 是进攻马，to 是防御马。 */
  modifyDistance?(input: { role: "from" | "to"; distance: number }): number;
  /** 八卦阵：判定牌为红色则抵消这次需要闪的结算。 */
  negateDodge?(flip: Card): boolean;
}
