export class EventBus<Events extends object> {
  private readonly listeners = new Map<
    string,
    Array<{ priority: number; fn: (payload: never) => void }>
  >();

  /**
   * priority 越大越先执行。相同优先级按注册顺序。
   * 返回取消订阅函数。
   */
  on<K extends keyof Events & string>(
    event: K,
    fn: (payload: Events[K]) => void,
    priority = 0,
  ): () => void {
    const list = this.listeners.get(event) ?? [];
    const entry = { priority, fn: fn as (payload: never) => void };
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
    this.listeners.set(event, list);
    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
    };
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    const list = [...(this.listeners.get(event) ?? [])];
    for (const entry of list) {
      (entry.fn as (payload: Events[K]) => void)(payload);
    }
  }
}
