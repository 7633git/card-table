export type RespondReason = "dodge" | "dying" | "strike";

export type PendingDecision =
  | {
      kind: "play";
      playerId: string;
    }
  | {
      kind: "discard";
      playerId: string;
      /** 本阶段必须弃掉的张数，等于手牌数减去当前体力。 */
      count: number;
    }
  | {
      kind: "respond";
      id: string;
      playerId: string;
      reason: RespondReason;
      acceptTypes: string[];
      allowPass: boolean;
      timeoutMs: number;
      expiresAt: number;
      sourcePlayerId?: string;
      sourceCardId?: string;
      dyingPlayerId?: string;
    };
