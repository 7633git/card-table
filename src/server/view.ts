import { PHASE_LABEL } from "../model/phase.js";
import type { GameState } from "../model/game-state.js";
import type { Card } from "../model/card.js";
import type { EquipmentSlots } from "../model/player.js";
import type { ActionRequest, InteractionState } from "../model/action.js";
import type { PendingDecision } from "../model/pending.js";
import type { Phase } from "../model/phase.js";
import { heroById, skillById } from "../skills/characters.js";
import { SKILL_TIMING } from "../skills/timing.js";

export interface SeatInfo {
  playerId: string;
  name: string;
  connected: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  role: string;
  heroId?: string;
  heroName?: string;
  skills: PublicSkill[];
  hp: number;
  maxHp: number;
  alive: boolean;
  handCount: number;
  /** 只有本人能看到牌面。其他人是 null。 */
  hand: Card[] | null;
  equipment: EquipmentSlots;
  judgmentZone: Card[];
  strikesUsedThisTurn: number;
}

/** 发给某一个连接的可见局面。牌堆顺序和别人的手牌不在这里。 */
export interface PublicSkill {
  id: string;
  name: string;
  description: string;
  /** 出牌阶段要点按钮的技能，例如制衡。 */
  active: boolean;
  usable: boolean;
}

export interface LegalPlay {
  cardId: string;
  /** 空数组表示打出这张牌不用再点人。 */
  targets: string[];
  /** 这张牌被当成杀打出。 */
  as?: "strike";
}

export interface ClientView {
  you: string;
  over: boolean;
  winners: string[];
  winReason?: string;
  turnNumber: number;
  phase: Phase;
  phaseLabel: string;
  currentPlayerId: string;
  interaction: InteractionState;
  action: ActionRequest | null;
  pending: PendingDecision | null;
  deckCount: number;
  discardPile: Card[];
  processing: Card[];
  players: PublicPlayer[];
  /** 只列出你现在能打出的牌，以及每张牌可以点的人。 */
  plays: LegalPlay[];
  /** 你现在可以响应打出的牌。别人的窗口是空的。 */
  answers: string[];
  log: string[];
}

export function viewFor(
  state: GameState,
  viewerId: string,
  seats: SeatInfo[],
  plays: LegalPlay[] = [],
  answers: string[] = [],
): ClientView {
  const connected = new Map(seats.map((seat) => [seat.playerId, seat.connected]));
  const current = state.players[state.currentPlayerIndex];
  return {
    you: viewerId,
    over: state.over,
    winners: state.winners,
    winReason: state.winReason,
    turnNumber: state.turnNumber,
    phase: state.phase,
    phaseLabel: PHASE_LABEL[state.phase],
    currentPlayerId: current?.id ?? "",
    interaction: state.interaction,
    action: state.action,
    pending: state.pending,
    deckCount: state.deck.length,
    discardPile: state.discardPile,
    processing: state.processing,
    plays,
    answers,
    log: state.log,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: connected.get(player.id) ?? true,
      role: shownRole(player.role, player.id === viewerId),
      heroId: player.heroId,
      heroName: player.heroId ? heroById(player.heroId)?.name : undefined,
      skills: player.skillIds.flatMap((skillId) => {
        const skill = skillById(skillId);
        if (!skill) return [];
        const active = skill.timings.includes(SKILL_TIMING.PHASE_ACTION_SKILL);
        const playWindow =
          state.pending?.kind === "play" &&
          state.pending.playerId === player.id &&
          state.interaction === "idle" &&
          !state.over;
        const owned =
          player.hand.length +
          Object.values(player.equipment).filter((card) => card !== undefined).length;
        return [
          {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            active,
            usable: active && playWindow && !player.usedSkills.includes(skill.id) && owned > 0,
          },
        ];
      }),
      hp: player.hp,
      maxHp: player.maxHp,
      alive: player.alive,
      handCount: player.hand.length,
      hand: player.id === viewerId ? player.hand : null,
      equipment: player.equipment,
      judgmentZone: player.judgmentZone,
      strikesUsedThisTurn: player.strikesUsedThisTurn,
    })),
  };
}

/** 主公公开。自己看得到自己的身份。忠臣、反贼、内奸对别人保密。 */
function shownRole(role: string, self: boolean): string {
  if (self || role === "lord" || role === "unassigned") return role;
  return "hidden";
}
