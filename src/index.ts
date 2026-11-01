export { EventBus } from "./bus/event-bus.js";
export {
  fail,
  pass,
  type CardDefinition,
  type EffectApi,
  type PlayContext,
  type RespondContext,
  type RuleCheck,
} from "./cards/definition.js";
export { createManualClock, createSystemClock, type GameClock } from "./engine/clock.js";
export { GameEngine, type CreateGameOptions, type PlayerSetup } from "./engine/game-engine.js";
export { GameRuleError } from "./errors.js";
export { ACTION_TIMEOUT_MS, type ActionRequest, type InteractionState } from "./model/action.js";
export {
  CARD_SPECS,
  createCard,
  isRed,
  type BasicCardType,
  type Card,
  type CardCategory,
  type CardKind,
  type CardType,
  type EquipSlot,
  type Suit,
  type TargetKind,
} from "./model/card.js";
export type { GameEventMap } from "./model/events.js";
export type { GameState, WinCheck } from "./model/game-state.js";
export type { PendingDecision, RespondReason } from "./model/pending.js";
export { PHASE_LABEL, PHASE_ORDER, type Phase } from "./model/phase.js";
export type { EquipmentSlots, PlayerState, Role } from "./model/player.js";
export type { HeroSkill, SkillHooks } from "./skills/hero-skill.js";
export { HEROES, createHeroSkill, heroById, skillById, type Hero } from "./skills/characters.js";
export { SKILL_TIMING, type Skill, type SkillTiming } from "./skills/timing.js";
export { identityWin, openingVitals } from "./rules/identity.js";
