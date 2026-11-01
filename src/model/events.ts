import type { ActionRequest } from "./action.js";
import type { Card } from "./card.js";
import type { Phase } from "./phase.js";
import type { RespondReason } from "./pending.js";

export type DamageNature = "normal" | "fire" | "thunder";

export interface PhasePayload {
  playerId: string;
  phase: Phase;
  turnNumber: number;
}

export interface DamageContext {
  sourceId?: string;
  targetId: string;
  amount: number;
  nature: DamageNature;
  card?: Card;
  reason: string;
  /** 监听方可以改成 true，这次伤害就不落地。 */
  prevented: boolean;
}

export interface HealContext {
  sourceId: string;
  targetId: string;
  amount: number;
  card?: Card;
  prevented: boolean;
}

export interface DrawContext {
  playerId: string;
  /** draw:before 里可以改张数。 */
  count: number;
  drawn: Card[];
  cause: "phase" | "skill" | "card";
}

export interface CardBeforePlayEvent {
  playerId: string;
  card: Card;
  targets: string[];
  cancelled: boolean;
}

export interface ResponseOpenEvent {
  playerId: string;
  reason: RespondReason;
  /** 监听方可以往这里追加可响应的牌类型。 */
  acceptTypes: string[];
  allowPass: boolean;
  sourcePlayerId?: string;
  sourceCardId?: string;
}

export interface SkillInvokeEvent {
  playerId: string;
  skillId: string;
  payload: unknown;
  /** 技能监听方处理完后设为 true。没人处理就会被引擎拒绝。 */
  handled: boolean;
}

export interface GameEventMap {
  "game:start": { playerIds: string[] };
  "game:over": { winners: string[]; reason?: string };
  "turn:start": { playerId: string; turnNumber: number };
  "turn:end": { playerId: string; turnNumber: number };
  "phase:enter": PhasePayload;
  "phase:exit": PhasePayload;
  "phase:skipped": PhasePayload;
  "card:beforePlay": CardBeforePlayEvent;
  "card:played": { playerId: string; card: Card; targets: string[] };
  "card:responded": { playerId: string; card: Card; reason: RespondReason };
  "card:discarded": { playerId?: string; cards: Card[]; reason: string };
  "draw:before": DrawContext;
  "draw:after": DrawContext;
  "damage:before": DamageContext;
  "damage:dealt": DamageContext;
  "damage:prevented": DamageContext;
  "heal:before": HealContext;
  "heal:after": HealContext;
  "hp:changed": {
    playerId: string;
    hp: number;
    maxHp: number;
    delta: number;
    cause: "damage" | "heal";
  };
  "player:dying": { playerId: string; hp: number };
  "player:died": { playerId: string };
  "strike:negated": {
    sourceId: string;
    targetId: string;
    strike: Card;
    dodge: Card;
  };
  "distance:calc": { fromId: string; toId: string; distance: number };
  "range:calc": { playerId: string; range: number };
  "strikeLimit:calc": { playerId: string; limit: number };
  "response:open": ResponseOpenEvent;
  "action:requested": ActionRequest;
  "action:resolved": {
    id: string;
    playerId: string;
    cardId: string | null;
    timedOut: boolean;
    interaction: ActionRequest["interaction"];
  };
  "skill:invoke": SkillInvokeEvent;
  "deck:reshuffled": { count: number };
  "judge:before": { playerId: string; card: Card; cancelled: boolean };
  "judge:flip": { playerId: string; sourceId?: string; card: Card; hit: boolean };
}
