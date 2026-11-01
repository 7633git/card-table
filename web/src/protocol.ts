/** 与服务器发给单个连接的 ClientView 对齐。牌堆顺序和别人的手牌不会出现。 */

export interface Card {
  id: string;
  type: string;
  name: string;
  category: string;
  kind?: "BASIC" | "SCROLL" | "DELAYED_SCROLL" | "EQUIP";
  suit: "spade" | "heart" | "club" | "diamond" | "none";
  rank: number;
  target?: "none" | "self" | "other" | "all";
  distanceLimit?: number | null;
  slot?: string;
}

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  role: string;
  heroId?: string;
  heroName?: string;
  skills?: PublicSkill[];
  hp: number;
  maxHp: number;
  alive: boolean;
  handCount: number;
  hand: Card[] | null;
  equipment: {
    weapon?: Card;
    armor?: Card;
    horseDefensive?: Card;
    horseOffensive?: Card;
  };
  judgmentZone: Card[];
  strikesUsedThisTurn: number;
}

export interface ActionRequest {
  id: string;
  playerId: string;
  interaction: "WAITING_RESPONSE" | "DYING";
  acceptTypes: string[];
  allowPass: boolean;
  timeoutMs: number;
  startedAt: number;
  expiresAt: number;
  remainingMs: number;
  sourcePlayerId?: string;
  sourceCardId?: string;
  dyingPlayerId?: string;
  followingPlayerIds: string[];
}

export type PendingDecision =
  | { kind: "play"; playerId: string }
  | { kind: "discard"; playerId: string; count: number }
  | {
      kind: "respond";
      id: string;
      playerId: string;
      reason: "dodge" | "dying";
      acceptTypes: string[];
      allowPass: boolean;
      timeoutMs: number;
      expiresAt: number;
      sourcePlayerId?: string;
      sourceCardId?: string;
      dyingPlayerId?: string;
    };

export interface PublicSkill {
  id: string;
  name: string;
  description: string;
  active: boolean;
  usable: boolean;
}

export interface HeroOption {
  id: string;
  name: string;
  maxHp: number;
  skillName: string;
  skillText: string;
}

export interface LegalPlay {
  cardId: string;
  targets: string[];
  as?: "strike";
}

export interface ClientView {
  you: string;
  over: boolean;
  winners: string[];
  winReason?: string;
  turnNumber: number;
  phase: string;
  phaseLabel: string;
  currentPlayerId: string;
  interaction: "idle" | "WAITING_RESPONSE" | "DYING";
  action: ActionRequest | null;
  pending: PendingDecision | null;
  deckCount: number;
  discardPile: Card[];
  processing: Card[];
  players: PublicPlayer[];
  plays?: LegalPlay[];
  answers?: string[];
  log?: string[];
}

export interface LobbyView {
  roomId: string;
  seats: number;
  started: boolean;
  solo?: boolean;
  identity?: boolean;
  picking?: boolean;
  heroes?: HeroOption[];
  players: Array<{ playerId: string; name: string; connected: boolean }>;
}

export interface ServerErrorMessage {
  code: string;
  message: string;
}

export function playerName(view: ClientView, playerId: string | undefined): string {
  if (!playerId) return "某人";
  return view.players.find((player) => player.id === playerId)?.name ?? playerId;
}

export function rankLabel(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank || "");
}
