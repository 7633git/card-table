export const PHASE_ORDER = [
  "start",
  "judge",
  "draw",
  "play",
  "discard",
  "end",
] as const;

export type Phase = (typeof PHASE_ORDER)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  start: "开始阶段",
  judge: "判定阶段",
  draw: "摸牌阶段",
  play: "出牌阶段",
  discard: "弃牌阶段",
  end: "结束阶段",
};

export function nextPhase(phase: Phase): Phase {
  const index = PHASE_ORDER.indexOf(phase);
  const next = PHASE_ORDER[index + 1];
  return next ?? PHASE_ORDER[0];
}
