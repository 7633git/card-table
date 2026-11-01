/** 规则被拒绝时抛出。code 给界面分支，message 给人读。 */
export class GameRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}
