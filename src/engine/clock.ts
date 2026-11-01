/** 引擎用它读时间、挂超时。测试可以换成手动时钟，不用真等 15 秒。 */
export interface GameClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface TimerHandle {
  at: number;
  callback: () => void;
}

export function createSystemClock(): GameClock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

/** 时间停在 start，只有 advance 才会把到期的回调跑掉。 */
export function createManualClock(start = 0): GameClock & { advance(ms: number): void } {
  let now = start;
  const timers: TimerHandle[] = [];
  return {
    now: () => now,
    setTimeout(callback, ms) {
      const handle: TimerHandle = { at: now + Math.max(0, ms), callback };
      timers.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const index = timers.indexOf(handle as TimerHandle);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      while (guard < 1000) {
        guard += 1;
        let nextIndex = -1;
        for (let index = 0; index < timers.length; index += 1) {
          const timer = timers[index];
          if (!timer || timer.at > target) continue;
          if (nextIndex < 0 || timer.at < (timers[nextIndex]?.at ?? Infinity)) {
            nextIndex = index;
          }
        }
        if (nextIndex < 0) break;
        const [timer] = timers.splice(nextIndex, 1);
        if (!timer) break;
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
  };
}
