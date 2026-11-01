import type { GameEngine } from "../engine/game-engine.js";

export type ClientCommand =
  | { type: "play"; cardId: string; targets: string[]; pick?: string; as?: "strike" }
  | { type: "resolve"; cardId: string | null }
  | { type: "endPlay" }
  | { type: "discard"; cardIds: string[] }
  | { type: "invokeSkill"; skillId: string; payload?: unknown };

export function readCommand(
  type: string,
  payload: unknown,
): ClientCommand | { error: string } {
  const body = isRecord(payload) ? payload : {};
  switch (type) {
    case "play": {
      if (typeof body.cardId !== "string" || body.cardId.length === 0) {
        return { error: "缺少 cardId" };
      }
      const targets = readIds(body.targets);
      if (!targets) return { error: "targets 必须是字符串数组" };
      if (body.pick !== undefined && (typeof body.pick !== "string" || body.pick.length === 0)) {
        return { error: "pick 必须是字符串" };
      }
      if (body.as !== undefined && body.as !== "strike") return { error: "as 只能是 strike" };
      return {
        type: "play",
        cardId: body.cardId,
        targets,
        pick: typeof body.pick === "string" ? body.pick : undefined,
        as: body.as === "strike" ? "strike" : undefined,
      };
    }
    case "resolve": {
      if (body.cardId !== undefined && body.cardId !== null && typeof body.cardId !== "string") {
        return { error: "cardId 必须是字符串或 null" };
      }
      return { type: "resolve", cardId: typeof body.cardId === "string" ? body.cardId : null };
    }
    case "endPlay":
      return { type: "endPlay" };
    case "discard": {
      const cardIds = readIds(body.cardIds);
      if (!cardIds) return { error: "cardIds 必须是字符串数组" };
      return { type: "discard", cardIds };
    }
    case "invokeSkill": {
      if (typeof body.skillId !== "string" || body.skillId.length === 0) {
        return { error: "缺少 skillId" };
      }
      return { type: "invokeSkill", skillId: body.skillId, payload: body.payload };
    }
    default:
      return { error: "未知消息" };
  }
}

export function applyCommand(engine: GameEngine, playerId: string, command: ClientCommand): void {
  switch (command.type) {
    case "play":
      engine.playCard({
        playerId,
        cardId: command.cardId,
        targets: command.targets,
        pick: command.pick,
        as: command.as,
      });
      return;
    case "resolve":
      engine.resolveAction(playerId, command.cardId);
      return;
    case "endPlay":
      engine.endPlay(playerId);
      return;
    case "discard":
      engine.discard({ playerId, cardIds: command.cardIds });
      return;
    case "invokeSkill":
      engine.invokeSkill({ playerId, skillId: command.skillId, payload: command.payload });
      return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== "string")) return null;
  return value;
}
