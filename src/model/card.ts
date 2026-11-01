import { GameRuleError } from "../errors.js";

export type CardCategory = "basic" | "trick" | "delayed-trick" | "equip";

/** 和界面约定的大类。basic 基本牌，trick 锦囊，delayed-trick 延时锦囊，equip 装备。 */
export type CardKind = "BASIC" | "SCROLL" | "DELAYED_SCROLL" | "EQUIP";

export type EquipSlot = "weapon" | "armor" | "horse-plus" | "horse-minus";

/** none 直接打出；self 对自己；other 指定一名其他角色；all 对所有其他角色。 */
export type TargetKind = "none" | "self" | "other" | "all";

export type Suit = "spade" | "heart" | "club" | "diamond" | "none";

export type BasicCardType = "strike" | "dodge" | "heal";

export interface CardSpec {
  name: string;
  category: CardCategory;
  kind: CardKind;
  target: TargetKind;
  /** other 时的距离上限。null 表示不看距离。杀改用攻击范围。 */
  distanceLimit: number | null;
  useAttackRange?: boolean;
  slot?: EquipSlot;
}

/** 一张牌的实例。效果不写在这里，由同 type 的 Handler 解释。 */
export interface Card {
  id: string;
  type: string;
  name: string;
  category: CardCategory;
  kind: CardKind;
  suit: Suit;
  rank: number;
  target: TargetKind;
  distanceLimit: number | null;
  useAttackRange?: boolean;
  slot?: EquipSlot;
}

export const CARD_SPECS = {
  strike: {
    name: "杀",
    category: "basic",
    kind: "BASIC",
    target: "other",
    distanceLimit: null,
    useAttackRange: true,
  },
  dodge: {
    name: "闪",
    category: "basic",
    kind: "BASIC",
    target: "none",
    distanceLimit: null,
  },
  heal: {
    name: "桃",
    category: "basic",
    kind: "BASIC",
    target: "self",
    distanceLimit: null,
  },
  dismantle: {
    name: "过河拆桥",
    category: "trick",
    kind: "SCROLL",
    target: "other",
    distanceLimit: null,
  },
  snatch: {
    name: "顺手牵羊",
    category: "trick",
    kind: "SCROLL",
    target: "other",
    distanceLimit: 1,
  },
  "ex-nihilo": {
    name: "无中生有",
    category: "trick",
    kind: "SCROLL",
    target: "none",
    distanceLimit: null,
  },
  duel: {
    name: "决斗",
    category: "trick",
    kind: "SCROLL",
    target: "other",
    distanceLimit: null,
  },
  barbarian: {
    name: "南蛮入侵",
    category: "trick",
    kind: "SCROLL",
    target: "all",
    distanceLimit: null,
  },
  arrows: {
    name: "万箭齐发",
    category: "trick",
    kind: "SCROLL",
    target: "all",
    distanceLimit: null,
  },
  indulgence: {
    name: "乐不思蜀",
    category: "delayed-trick",
    kind: "DELAYED_SCROLL",
    target: "other",
    distanceLimit: null,
  },
  crossbow: {
    name: "诸葛连弩",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: "weapon",
  },
  bagua: {
    name: "八卦阵",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: "armor",
  },
  "horse-plus": {
    name: "+1马",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: "horse-plus",
  },
  "horse-minus": {
    name: "-1马",
    category: "equip",
    kind: "EQUIP",
    target: "none",
    distanceLimit: null,
    slot: "horse-minus",
  },
} as const satisfies Record<string, CardSpec>;

export type CardType = keyof typeof CARD_SPECS;

let cardSeq = 0;

export function cardSpec(type: string): CardSpec {
  const spec = CARD_SPECS[type as CardType];
  if (!spec) throw new GameRuleError("UNKNOWN_CARD", `未知卡牌类型：${type}`);
  return spec;
}

export function createCard(
  type: CardType | BasicCardType,
  extra: Partial<Omit<Card, "type" | "category" | "name" | "kind" | "target">> & { name?: string } = {},
): Card {
  cardSeq += 1;
  const spec = cardSpec(type);
  return {
    id: extra.id ?? `card_${cardSeq}`,
    type,
    name: extra.name ?? spec.name,
    category: spec.category,
    kind: spec.kind,
    suit: extra.suit ?? "none",
    rank: extra.rank ?? 0,
    target: spec.target,
    distanceLimit: spec.distanceLimit,
    useAttackRange: spec.useAttackRange,
    slot: spec.slot,
  };
}

export function isRed(suit: Suit): boolean {
  return suit === "heart" || suit === "diamond";
}
