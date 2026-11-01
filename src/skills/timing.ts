import type { Card } from "../model/card.js";
import type { DamageContext } from "../model/events.js";
import type { GameState } from "../model/game-state.js";
import type { SkillHooks } from "./hero-skill.js";

/** 技能在引擎里被询问的时机。 */
export const SKILL_TIMING = {
  CHECK_ATTACK_LIMIT: "CHECK_ATTACK_LIMIT",
  TRANSFORM_CARD: "TRANSFORM_CARD",
  PHASE_ACTION_SKILL: "PHASE_ACTION_SKILL",
  AFTER_DAMAGE: "AFTER_DAMAGE",
} as const;

export type SkillTiming = (typeof SKILL_TIMING)[keyof typeof SKILL_TIMING];

/**
 * 武将技能。引擎在对应时机调用钩子，技能自己决定改不改结果。
 * 没有实现的钩子就跳过。
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  timings: SkillTiming[];
  /** 出杀次数。返回新的上限，咆哮会返回无限。 */
  checkAttackLimit?(limit: number, state: GameState, playerId: string): number;
  /** 这张牌能不能当成 asType 使用或打出。武圣把红色牌当成杀。 */
  transformCard?(card: Card, asType: string, state: GameState, playerId: string): boolean;
  /** 出牌阶段主动技。返回 true 表示已经发动。 */
  phaseAction?(payload: unknown, api: SkillHooks): boolean;
  /** 伤害已经扣到体力上，濒死求桃之前。 */
  afterDamage?(damage: DamageContext, api: SkillHooks): void;
}
