import type { WinCheck } from "../model/game-state.js";
import type { GameState } from "../model/game-state.js";
import type { Role } from "../model/player.js";

/** 主公体力上限加 1，当前体力一起加上。 */
export function openingVitals(heroHp: number, role: Role | undefined): { hp: number; maxHp: number } {
  const maxHp = heroHp + (role === "lord" ? 1 : 0);
  return { hp: maxHp, maxHp };
}

/**
 * 四人身份局。
 * 主公阵亡时，只剩内奸一人则内奸胜，否则反贼胜。
 * 反贼和内奸都死光，主公和忠臣胜。
 * 没有主公时返回 null，交给原来的最后一人规则。
 */
export function identityWin(state: GameState): WinCheck | null {
  const lord = state.players.find((player) => player.role === "lord");
  if (!lord) return null;
  const alive = state.players.filter((player) => player.alive);
  if (!lord.alive) {
    const last = alive.length === 1 ? alive[0] : undefined;
    if (last?.role === "spy") {
      return { over: true, winners: [last.id], reason: "spy" };
    }
    return {
      over: true,
      winners: state.players.filter((player) => player.role === "rebel").map((player) => player.id),
      reason: "rebel",
    };
  }
  const threat = alive.some((player) => player.role === "rebel" || player.role === "spy");
  if (!threat) {
    return {
      over: true,
      winners: state.players
        .filter((player) => player.role === "lord" || player.role === "loyalist")
        .map((player) => player.id),
      reason: "lord-loyalist",
    };
  }
  return { over: false, winners: [] };
}
