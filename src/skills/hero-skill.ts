import type { Card } from "../model/card.js";
import type { DamageNature, GameEventMap } from "../model/events.js";
import type { GameState } from "../model/game-state.js";
import type { Phase } from "../model/phase.js";
import type { Skill } from "./timing.js";

/**
 * 武将技能的安装口。
 * 触发型技能订阅事件，直接改写上下文，例如在 damage:before 里把 prevented 设为 true。
 * 主动技能在自己的出牌窗口监听 skill:invoke，处理完把 handled 设为 true。
 * 伤害和治疗的监听里只改上下文，不要在回调里再造成伤害或打开新的询问。
 */
export interface SkillHooks {
  readonly ownerId: string;
  on<K extends keyof GameEventMap>(
    event: K,
    listener: (payload: GameEventMap[K]) => void,
    priority?: number,
  ): void;
  getState(): GameState;
  skipPhase(phase: Phase): void;
  draw(count: number): Card[];
  damage(request: {
    sourceId?: string;
    targetId: string;
    amount: number;
    nature?: DamageNature;
    reason: string;
    card?: Card;
  }): void;
  heal(request: {
    sourceId: string;
    targetId: string;
    amount: number;
    card?: Card;
  }): void;
  /** 把技能登记到出杀、转化、主动技和受伤钩子上。 */
  bind(skill: Skill): void;
  note(line: string): void;
  /** 从结算区拿走造成伤害的那张牌，放进自己手里。 */
  gain(card?: Card): boolean;
  /** 弃置自己的手牌或装备。有任何一张不属于你，就一张都不弃。 */
  discardCards(cardIds: string[]): number;
  /** 本回合还没发动过这个主动技。 */
  available(skillId: string): boolean;
  /** 记下本回合已经发动过。 */
  spend(skillId: string): boolean;
}

export interface HeroSkill {
  id: string;
  name: string;
  description?: string;
  install(hooks: SkillHooks): void;
}
