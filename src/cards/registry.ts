import { GameRuleError } from "../errors.js";
import type { RespondReason } from "../model/pending.js";
import type { CardDefinition } from "./definition.js";

export class CardRegistry {
  private readonly defs = new Map<string, CardDefinition>();

  register(definition: CardDefinition): void {
    this.defs.set(definition.type, definition);
  }

  get(type: string): CardDefinition {
    const definition = this.defs.get(type);
    if (!definition) {
      throw new GameRuleError("UNKNOWN_CARD", `未知卡牌类型：${type}`);
    }
    return definition;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  typesFor(reason: RespondReason): string[] {
    return [...this.defs.values()]
      .filter((definition) => definition.answers.includes(reason))
      .map((definition) => definition.type);
  }

  list(): CardDefinition[] {
    return [...this.defs.values()];
  }
}
