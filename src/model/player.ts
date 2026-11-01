import type { Card } from "./card.js";
import type { Phase } from "./phase.js";

/** 身份局席位。胜负判定可以以后单独替换，角色数据先留在玩家身上。 */
export type Role = "lord" | "loyalist" | "rebel" | "spy" | "unassigned";

export interface EquipmentSlots {
  weapon?: Card;
  armor?: Card;
  horseDefensive?: Card;
  horseOffensive?: Card;
}

export interface PlayerState {
  id: string;
  name: string;
  role: Role;
  heroId?: string;
  hp: number;
  maxHp: number;
  hand: Card[];
  equipment: EquipmentSlots;
  judgmentZone: Card[];
  skillIds: string[];
  /** 本回合已经发动过的主动技。回合开始清空。 */
  usedSkills: string[];
  alive: boolean;
  /** 本回合已经打出的杀，闪掉也算次数。 */
  strikesUsedThisTurn: number;
  /** 本回合要跳过的阶段。回合开始时清空，技能再写回来。 */
  skip: Partial<Record<Phase, boolean>>;
}
