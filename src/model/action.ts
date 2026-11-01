/** 杀的闪、濒死求桃，默认都给 15 秒。 */
export const ACTION_TIMEOUT_MS = 15_000;

/** idle 表示没有人正在响应。另外两个值是网络和前端要等的交互态。 */
export type InteractionState = "idle" | "WAITING_RESPONSE" | "DYING";

/**
 * 当前这一条行动请求。
 * 倒计时用 expiresAt 对齐主机时钟，remainingMs 在取快照时现算。
 */
export interface ActionRequest {
  id: string;
  playerId: string;
  interaction: Exclude<InteractionState, "idle">;
  acceptTypes: string[];
  allowPass: boolean;
  timeoutMs: number;
  startedAt: number;
  expiresAt: number;
  remainingMs: number;
  sourcePlayerId?: string;
  sourceCardId?: string;
  /** 濒死求桃时，真正掉血的人。出桃的人可以是别人。 */
  dyingPlayerId?: string;
  /** 这一圈还没问到的玩家，不含当前这位。 */
  followingPlayerIds: string[];
}
