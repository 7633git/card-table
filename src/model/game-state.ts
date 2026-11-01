import type { ActionRequest, InteractionState } from "./action.js";
import type { Card } from "./card.js";
import type { PendingDecision } from "./pending.js";
import type { Phase } from "./phase.js";
import type { PlayerState } from "./player.js";

/**
 * 一份可序列化的对局快照。
 * 牌堆顶在数组开头，摸牌用 shift。
 * processing 里是正在结算、还没进弃牌堆的牌。
 */
export interface GameState {
  started: boolean;
  over: boolean;
  winners: string[];
  winReason?: string;
  turnNumber: number;
  currentPlayerIndex: number;
  phase: Phase;
  players: PlayerState[];
  deck: Card[];
  discardPile: Card[];
  processing: Card[];
  pending: PendingDecision | null;
  /** 没人响应时是 idle。出杀等闪是 WAITING_RESPONSE，求桃是 DYING。 */
  interaction: InteractionState;
  /** 网络端和前端当前要处理的那一条请求。没有则为 null。 */
  action: ActionRequest | null;
  /** 给牌桌战报的短句，只保留最近几十条。 */
  log: string[];
}

export type WinCheck = {
  over: boolean;
  winners: string[];
  reason?: string;
};
