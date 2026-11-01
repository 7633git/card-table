import { isRed } from "../model/card.js";
import type { HeroSkill } from "./hero-skill.js";
import { SKILL_TIMING, type Skill } from "./timing.js";

export interface Hero {
  id: string;
  name: string;
  maxHp: number;
  skillId: string;
}

const paoxiao: Skill = {
  id: "paoxiao",
  name: "咆哮",
  description: "出牌阶段，使用杀没有次数限制。",
  timings: [SKILL_TIMING.CHECK_ATTACK_LIMIT],
  checkAttackLimit() {
    return Number.POSITIVE_INFINITY;
  },
};

const wusheng: Skill = {
  id: "wusheng",
  name: "武圣",
  description: "红色手牌或红色装备牌可以当杀使用或打出。",
  timings: [SKILL_TIMING.TRANSFORM_CARD],
  transformCard(card, asType) {
    return asType === "strike" && isRed(card.suit);
  },
};

const jianxiong: Skill = {
  id: "jianxiong",
  name: "奸雄",
  description: "受到伤害后，获得对你造成伤害的那张牌。",
  timings: [SKILL_TIMING.AFTER_DAMAGE],
  afterDamage(damage, api) {
    if (!damage.card) return;
    if (!api.gain(damage.card)) return;
    const name = api.getState().players.find((player) => player.id === api.ownerId)?.name ?? "曹操";
    api.note(`${name} 发动奸雄，获得了 ${damage.card.name}`);
  },
};

const zhiheng: Skill = {
  id: "zhiheng",
  name: "制衡",
  description: "出牌阶段限一次，弃置任意张牌，然后摸等量的牌。",
  timings: [SKILL_TIMING.PHASE_ACTION_SKILL],
  phaseAction(payload, api) {
    if (!api.available("zhiheng")) return false;
    const ids = readCardIds(payload);
    if (ids.length === 0) return false;
    const count = api.discardCards(ids);
    if (count !== ids.length) return false;
    if (!api.spend("zhiheng")) return false;
    const drawn = api.draw(count);
    const name = api.getState().players.find((player) => player.id === api.ownerId)?.name ?? "孙权";
    api.note(`${name} 发动制衡，弃置 ${count} 张牌，摸了 ${drawn.length} 张牌`);
    return true;
  },
};

const SKILLS: Skill[] = [paoxiao, wusheng, jianxiong, zhiheng];

export const HEROES: Hero[] = [
  { id: "zhangfei", name: "张飞", maxHp: 4, skillId: paoxiao.id },
  { id: "guanyu", name: "关羽", maxHp: 4, skillId: wusheng.id },
  { id: "caocao", name: "曹操", maxHp: 4, skillId: jianxiong.id },
  { id: "sunquan", name: "孙权", maxHp: 4, skillId: zhiheng.id },
];

export function heroById(id: string): Hero | undefined {
  return HEROES.find((hero) => hero.id === id);
}

export function skillById(id: string): Skill | undefined {
  return SKILLS.find((skill) => skill.id === id);
}

/** 每个座位装一份技能。技能数据本身无状态，次数记在玩家身上。 */
export function createHeroSkill(skillId: string): HeroSkill {
  const skill = skillById(skillId);
  if (!skill) {
    throw new Error(`没有这个技能：${skillId}`);
  }
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    install(hooks) {
      hooks.bind(skill);
    },
  };
}

function readCardIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const value = (payload as { cardIds?: unknown }).cardIds;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    return [];
  }
  return [...new Set(value)];
}
