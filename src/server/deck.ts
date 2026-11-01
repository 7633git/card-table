import { createCard, type Card, type CardType, type Suit } from "../model/card.js";

const SUITS: Suit[] = ["spade", "heart", "club", "diamond"];

/**
 * 标准 60 张牌。人数不影响张数，开局每人发 4 张，其余留在牌堆。
 * 先按种类轮转排开，这样发牌阶段不会整手都是同一种牌。
 */
const MIX: CardType[] = [
  "strike",
  "dodge",
  "heal",
  "dismantle",
  "snatch",
  "ex-nihilo",
  "duel",
  "strike",
  "dodge",
  "indulgence",
  "barbarian",
  "arrows",
  "crossbow",
  "bagua",
  "horse-plus",
  "horse-minus",
  "strike",
  "heal",
  "dismantle",
  "snatch",
];

const COUNTS: Record<CardType, number> = {
  strike: 15,
  dodge: 10,
  heal: 6,
  dismantle: 4,
  snatch: 4,
  "ex-nihilo": 4,
  duel: 3,
  barbarian: 2,
  arrows: 2,
  indulgence: 3,
  crossbow: 2,
  bagua: 2,
  "horse-plus": 2,
  "horse-minus": 1,
};

export function buildDeck(_playerCount?: number): Card[] {
  const piles = new Map<CardType, number>();
  for (const [type, count] of Object.entries(COUNTS) as Array<[CardType, number]>) {
    piles.set(type, count);
  }
  const cards: Card[] = [];
  let serial = 0;
  while (cards.length < 60) {
    let added = false;
    for (const type of MIX) {
      const left = piles.get(type) ?? 0;
      if (left <= 0) continue;
      piles.set(type, left - 1);
      serial += 1;
      cards.push(
        createCard(type, {
          id: `${type}_${serial}`,
          suit: SUITS[serial % SUITS.length] ?? "none",
          rank: (serial % 13) + 1,
        }),
      );
      added = true;
      if (cards.length >= 60) break;
    }
    if (!added) break;
  }
  return cards;
}

/** 从牌堆顶轮流发牌。牌堆数组会被改短。 */
export function deal(deck: Card[], playerCount: number, handSize: number): Card[][] {
  const hands = Array.from({ length: playerCount }, () => [] as Card[]);
  for (let round = 0; round < handSize; round += 1) {
    for (let seat = 0; seat < playerCount; seat += 1) {
      const card = deck.shift();
      const hand = hands[seat];
      if (card && hand) hand.push(card);
    }
  }
  return hands;
}
