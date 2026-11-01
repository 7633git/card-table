import type { Card, ClientView } from "./protocol.js";

export interface Flight {
  key: string;
  card: Card;
  from: "hand" | "seat";
  seatId?: string;
  /** 出牌前量好的起点。新状态提交后，原来的牌已经不在手里。 */
  origin?: { x: number; y: number };
}

export interface HpPulse {
  key: string;
  playerId: string;
  delta: number;
}

/** 对手打出的牌，或发动的效果。留在桌心给所有人看。 */
export interface Reveal {
  key: string;
  actor: string;
  line: string;
  card?: Card;
}

let motionSeq = 0;

function nextKey(prefix: string): string {
  motionSeq += 1;
  return `${prefix}-${motionSeq}`;
}

/** 对比前后两帧，找出刚打出的牌和体力变化。开局第一帧不制造飞牌。 */
export function diffTable(prev: ClientView, next: ClientView): { flights: Flight[]; pulses: HpPulse[] } {
  const seen = new Set<string>();
  for (const card of prev.discardPile) seen.add(card.id);
  for (const card of prev.processing) seen.add(card.id);

  const arrived: Card[] = [];
  for (const card of [...next.processing, ...next.discardPile]) {
    if (seen.has(card.id) || arrived.some((item) => item.id === card.id)) continue;
    arrived.push(card);
  }

  const ownHand = new Set(
    (prev.players.find((player) => player.id === prev.you)?.hand ?? []).map((card) => card.id),
  );
  const seatId = seatThatLostCards(prev, next);

  const flights = arrived.map((card) => ({
    key: nextKey(card.id),
    card,
    from: ownHand.has(card.id) ? ("hand" as const) : ("seat" as const),
    seatId: ownHand.has(card.id) ? prev.you : seatId,
  }));

  const pulses: HpPulse[] = [];
  for (const player of next.players) {
    const before = prev.players.find((item) => item.id === player.id);
    if (!before || before.hp === player.hp) continue;
    pulses.push({ key: nextKey(player.id), playerId: player.id, delta: player.hp - before.hp });
  }

  return { flights, pulses };
}

/** 这一拍里对手新打出的牌和发动的效果。自己的出牌不重复展示。 */
export function diffReveals(prev: ClientView, next: ClientView): Reveal[] {
  const mine = next.players.find((player) => player.id === next.you)?.name;
  const lines = freshLines(prev.log ?? [], next.log ?? []).filter((line) => {
    if (!isOpponentPlay(line)) return false;
    const actor = leadingName(line, next);
    return Boolean(actor && actor !== mine);
  });
  const ownHand = new Set(
    (prev.players.find((player) => player.id === prev.you)?.hand ?? []).map((card) => card.id),
  );
  const cards = arrivedCards(prev, next).filter((card) => !ownHand.has(card.id));
  const used = new Set<string>();
  const reveals: Reveal[] = [];

  for (const line of lines) {
    let card = cards.find((item) => !used.has(item.id) && line.includes(item.name));
    if (!card && (line.includes("八卦阵") || line.includes("判定"))) {
      card = cards.find((item) => !used.has(item.id));
    }
    if (card) used.add(card.id);
    reveals.push({
      key: nextKey(card?.id ?? line),
      actor: leadingName(line, next) || "对手",
      line,
      card,
    });
  }

  for (const card of cards) {
    if (used.has(card.id)) continue;
    const actor = bearerName(prev, next, card.id) ?? nameOf(next, seatThatLostCards(prev, next)) ?? "对手";
    if (actor === mine) continue;
    reveals.push({
      key: nextKey(card.id),
      actor,
      line: `${actor} 打出了 ${card.name}`,
      card,
    });
  }

  return reveals;
}

function isOpponentPlay(line: string): boolean {
  return /使用了|打出了|装备了|八卦阵|判定|拿走了|拆掉了|弃置了|跳过|发动/.test(line);
}

function freshLines(prev: string[], next: string[]): string[] {
  if (next.length === 0) return [];
  for (let drop = 0; drop <= prev.length; drop += 1) {
    const tail = prev.slice(drop);
    if (tail.length === 0 && drop !== prev.length) continue;
    let matches = true;
    for (let index = 0; index < tail.length; index += 1) {
      if (next[index] !== tail[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return next.slice(tail.length);
  }
  return [];
}

function arrivedCards(prev: ClientView, next: ClientView): Card[] {
  const seen = new Set(publicCards(prev).map((card) => card.id));
  const arrived: Card[] = [];
  for (const card of publicCards(next)) {
    if (seen.has(card.id) || arrived.some((item) => item.id === card.id)) continue;
    arrived.push(card);
  }
  return arrived;
}

function publicCards(view: ClientView): Card[] {
  const cards = [...view.processing, ...view.discardPile];
  for (const player of view.players) {
    const equipment = player.equipment;
    for (const card of [equipment.weapon, equipment.armor, equipment.horseDefensive, equipment.horseOffensive]) {
      if (card) cards.push(card);
    }
    cards.push(...player.judgmentZone);
  }
  return cards;
}

function leadingName(line: string, view: ClientView): string {
  const names = view.players.map((player) => player.name).sort((a, b) => b.length - a.length);
  return names.find((name) => line.startsWith(name)) ?? "";
}

function nameOf(view: ClientView, playerId: string | undefined): string | undefined {
  if (!playerId) return undefined;
  return view.players.find((player) => player.id === playerId)?.name;
}

function bearerName(prev: ClientView, next: ClientView, cardId: string): string | undefined {
  for (const player of next.players) {
    const now = zoneCards(player);
    if (!now.some((card) => card.id === cardId)) continue;
    const before = prev.players.find((item) => item.id === player.id);
    if (before && zoneCards(before).some((card) => card.id === cardId)) continue;
    return player.name;
  }
  return undefined;
}

function zoneCards(player: ClientView["players"][number]): Card[] {
  const equipment = player.equipment;
  return [
    equipment.weapon,
    equipment.armor,
    equipment.horseDefensive,
    equipment.horseOffensive,
    ...player.judgmentZone,
  ].filter((card): card is Card => card !== undefined);
}

function seatThatLostCards(prev: ClientView, next: ClientView): string | undefined {
  let chosen: string | undefined;
  let lost = 0;
  for (const player of next.players) {
    if (player.id === next.you) continue;
    const before = prev.players.find((item) => item.id === player.id);
    if (!before) continue;
    const drop = before.handCount - player.handCount;
    if (drop > lost) {
      lost = drop;
      chosen = player.id;
    }
  }
  return chosen;
}
