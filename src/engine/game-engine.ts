import { EventBus } from "../bus/event-bus.js";
import { createBasicCards } from "../cards/basic.js";
import { createLibraryCards } from "../cards/library.js";
import type {
  CardDefinition,
  DamageRequest,
  EffectApi,
  HealRequest,
  PlayContext,
  RespondContext,
  ResponseRequest,
} from "../cards/definition.js";
import { CardRegistry } from "../cards/registry.js";
import { GameRuleError } from "../errors.js";
import { ACTION_TIMEOUT_MS, type ActionRequest } from "../model/action.js";
import type { Card, CardCategory } from "../model/card.js";
import type { GameEventMap, PhasePayload } from "../model/events.js";
import type { GameState, WinCheck } from "../model/game-state.js";
import type { PendingDecision } from "../model/pending.js";
import { nextPhase, type Phase } from "../model/phase.js";
import type { PlayerState, Role } from "../model/player.js";
import type { HeroSkill, SkillHooks } from "../skills/hero-skill.js";
import type { Skill } from "../skills/timing.js";
import { createSystemClock, type GameClock } from "./clock.js";

export interface PlayerSetup {
  id: string;
  name: string;
  hp?: number;
  maxHp?: number;
  role?: Role;
  heroId?: string;
  hand?: Card[];
  skills?: HeroSkill[];
}

export interface CreateGameOptions {
  players: PlayerSetup[];
  deck?: Card[];
  currentPlayerIndex?: number;
  /**
   * 默认从开始阶段跑完整回合。
   * 测试可以传 play，直接停在出牌阶段，手牌不会被摸牌阶段改掉。
   */
  startAt?: Phase;
  /** 默认不洗牌，方便按牌堆顺序复现。正式开局传 true。 */
  shuffle?: boolean;
  rng?: () => number;
  /**
   * 身份局胜负。返回 over 为 true 时立即结束。
   * 不传时，场上存活人数不超过 1 即结束。
   */
  winChecker?: (state: GameState) => WinCheck | null;
  /** 不传就用系统时间。测试传手动时钟，把 15 秒倒计时快进掉。 */
  clock?: GameClock;
}

interface WaitFrame {
  pending: Extract<PendingDecision, { kind: "respond" }>;
  action: ActionRequest;
  resolve: (card: Card | null) => void;
}

/**
 * 无界面对局引擎。
 *
 * 回合是六个阶段的状态机：开始 → 判定 → 摸牌 → 出牌 → 弃牌 → 结束。
 * 自动阶段会一直往前走，直到出牌、弃牌或响应窗口需要玩家表态。
 * 卡牌效果和武将技能都通过事件改写结算，不把特例写进阶段循环。
 */
export class GameEngine {
  private readonly state: GameState;
  private readonly bus = new EventBus<GameEventMap>();
  private readonly registry = new CardRegistry();
  private readonly api: EffectApi;
  private readonly waitStack: WaitFrame[] = [];
  private readonly boundSkills: Array<{ ownerId: string; skill: Skill }> = [];
  private readonly startAt: Phase;
  private readonly shuffleOnRecycle: boolean;
  private readonly rng: () => number;
  private readonly winChecker?: (state: GameState) => WinCheck | null;
  private readonly clock: GameClock;
  private responseSeq = 0;
  private started = false;
  private timer: unknown = null;
  private armedActionId: string | null = null;

  private constructor(options: CreateGameOptions) {
    if (options.players.length < 2) {
      throw new GameRuleError("NEED_PLAYERS", "至少需要两名玩家");
    }
    const ids = options.players.map((player) => player.id);
    if (new Set(ids).size !== ids.length) {
      throw new GameRuleError("DUPLICATE_PLAYER", "玩家 id 重复");
    }

    const currentPlayerIndex = options.currentPlayerIndex ?? 0;
    if (currentPlayerIndex < 0 || currentPlayerIndex >= options.players.length) {
      throw new GameRuleError("NO_PLAYER", "当前玩家座位不存在");
    }

    this.startAt = options.startAt ?? "start";
    this.shuffleOnRecycle = options.shuffle === true;
    this.rng = options.rng ?? Math.random;
    this.winChecker = options.winChecker;
    this.clock = options.clock ?? createSystemClock();
    this.state = {
      started: false,
      over: false,
      winners: [],
      turnNumber: 1,
      currentPlayerIndex,
      phase: this.startAt,
      players: options.players.map((setup) => this.createPlayer(setup)),
      deck: this.adoptCards(options.deck),
      discardPile: [],
      processing: [],
      pending: null,
      interaction: "idle",
      action: null,
      log: [],
    };
    this.assertUniqueCards();
    if (this.shuffleOnRecycle) this.shuffleCards(this.state.deck);

    this.api = this.createApi();
    for (const definition of [...createBasicCards(), ...createLibraryCards()]) {
      this.registry.register(definition);
    }
    options.players.forEach((setup, index) => {
      const player = this.state.players[index];
      if (!player) return;
      for (const skill of setup.skills ?? []) {
        this.installSkill(player.id, skill);
      }
    });
  }

  static create(options: CreateGameOptions): GameEngine {
    return new GameEngine(options);
  }

  /** 深拷贝。改返回值不会影响对局。事件回调里拿到的上下文是原对象，可以改。 */
  getState(): GameState {
    const snapshot = structuredClone(this.state);
    if (snapshot.action) {
      snapshot.action.remainingMs = Math.max(0, snapshot.action.expiresAt - this.clock.now());
    }
    return snapshot;
  }

  on<K extends keyof GameEventMap>(
    event: K,
    listener: (payload: GameEventMap[K]) => void,
    priority = 0,
  ): () => void {
    return this.bus.on(event, listener, priority);
  }

  registerCard(definition: CardDefinition): void {
    this.registry.register(definition);
  }

  listCards(): Array<{
    type: string;
    name: string;
    category: CardCategory;
    description: string;
  }> {
    return this.registry.list().map((definition) => ({
      type: definition.type,
      name: definition.name,
      category: definition.category,
      description: definition.description,
    }));
  }

  attachSkill(playerId: string, skill: HeroSkill): void {
    this.installSkill(playerId, skill);
  }

  getDistance(fromId: string, toId: string): number {
    if (fromId === toId) return 0;
    const alive = this.state.players.filter((player) => player.alive);
    const fromIndex = alive.findIndex((player) => player.id === fromId);
    const toIndex = alive.findIndex((player) => player.id === toId);
    if (fromIndex < 0 || toIndex < 0) {
      throw new GameRuleError("ILLEGAL_TARGET", "找不到玩家");
    }
    const count = alive.length;
    const clockwise = (toIndex - fromIndex + count) % count;
    const counter = (fromIndex - toIndex + count) % count;
    let distance = Math.min(clockwise, counter);
    const from = this.must(fromId);
    const to = this.must(toId);
    distance = this.applyHorse(from.equipment.horseOffensive, "from", distance);
    distance = this.applyHorse(to.equipment.horseDefensive, "to", distance);
    const ctx = { fromId, toId, distance };
    this.bus.emit("distance:calc", ctx);
    return Math.max(0, ctx.distance);
  }

  getAttackRange(playerId: string): number {
    this.must(playerId);
    const ctx = { playerId, range: 1 };
    this.bus.emit("range:calc", ctx);
    return Math.max(0, ctx.range);
  }

  getStrikeLimit(playerId: string): number {
    const player = this.must(playerId);
    let limit = 1;
    const weapon = player.equipment.weapon;
    if (weapon) {
      limit = this.registry.get(weapon.type).modifyStrikeLimit?.(limit) ?? limit;
    }
    for (const bound of this.boundSkills) {
      if (bound.ownerId !== playerId || !bound.skill.checkAttackLimit) continue;
      limit = bound.skill.checkAttackLimit(limit, this.getState(), playerId);
    }
    const ctx = { playerId, limit };
    this.bus.emit("strikeLimit:calc", ctx);
    return Math.max(0, ctx.limit);
  }

  /** 当前响应窗口里可以打出的牌，含武圣转化。不是你响应时为空。 */
  legalAnswers(playerId: string): string[] {
    const action = this.state.action;
    if (!action || action.playerId !== playerId || this.state.over) return [];
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) return [];
    const ids: string[] = [];
    for (const card of [...player.hand, ...this.equipmentCards(player)]) {
      const inHand = player.hand.some((item) => item.id === card.id);
      if (inHand && action.acceptTypes.includes(card.type)) {
        ids.push(card.id);
        continue;
      }
      if (action.acceptTypes.includes("strike") && card.type !== "strike" && this.transforms(playerId, card, "strike")) {
        ids.push(card.id);
      }
    }
    return ids;
  }

  /**
   * 当前出牌窗口里，这名玩家真正能打出的牌。
   * targets 为空表示不用再点人；否则是可以点的角色。
   */
  legalPlays(playerId: string): Array<{ cardId: string; targets: string[]; as?: "strike" }> {
    if (!this.started || this.state.over) return [];
    const pending = this.state.pending;
    if (!pending || pending.kind !== "play" || pending.playerId !== playerId) return [];
    if (this.waitStack.length > 0) return [];
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) return [];
    const plays: Array<{ cardId: string; targets: string[]; as?: "strike" }> = [];
    for (const card of player.hand) {
      const definition = this.registry.get(card.type);
      if (definition.target === "other") {
        const targets = this.state.players
          .filter((item) => item.alive && item.id !== playerId)
          .map((item) => item.id)
          .filter((id) => definition.canPlay(this.playContext(playerId, card, [id])).ok);
        if (targets.length > 0) plays.push({ cardId: card.id, targets });
        continue;
      }
      const seeded = this.playContext(playerId, card, []);
      const targets = definition.normalizeTargets?.(seeded) ?? [];
      if (definition.canPlay(this.playContext(playerId, card, targets)).ok) {
        plays.push({ cardId: card.id, targets: [] });
      }
    }
    const strike = this.registry.get("strike");
    for (const card of [...player.hand, ...this.equipmentCards(player)]) {
      if (card.type === "strike" || !this.transforms(playerId, card, "strike")) continue;
      const targets = this.state.players
        .filter((item) => item.alive && item.id !== playerId)
        .map((item) => item.id)
        .filter((id) => strike.canPlay(this.playContext(playerId, card, [id])).ok);
      if (targets.length > 0) plays.push({ cardId: card.id, targets, as: "strike" });
    }
    return plays;
  }

  /** 开局，并自动走到第一个需要玩家操作的窗口。 */
  start(): void {
    if (this.started) throw new GameRuleError("ALREADY_STARTED", "对局已经开始");
    this.started = true;
    this.state.started = true;
    this.bus.emit("game:start", {
      playerIds: this.state.players.map((player) => player.id),
    });
    this.beginTurnFlags();
    this.state.phase = this.startAt;
    this.state.turnNumber = 1;
    this.bus.emit("turn:start", {
      playerId: this.current().id,
      turnNumber: this.state.turnNumber,
    });
    this.bus.emit("phase:enter", this.phasePayload());
    this.runPhaseBody();
    this.pump();
  }

  playCard(input: {
    playerId: string;
    cardId: string;
    targets?: string[];
    pick?: string;
    /** 把这张牌当杀使用。只有转化技能会接受。 */
    as?: "strike";
  }): void {
    this.assertStarted();
    this.assertNotOver();
    const pending = this.state.pending;
    if (!pending || pending.kind !== "play" || pending.playerId !== input.playerId) {
      throw new GameRuleError("NOT_PLAY_WINDOW", "当前不能出牌");
    }
    if (this.waitStack.length > 0) {
      throw new GameRuleError("BUSY", "还有未结算的效果");
    }

    const player = this.must(input.playerId);
    const located = this.locateCard(player, input.cardId);
    if (!located) throw new GameRuleError("CARD_NOT_IN_HAND", "手牌中没有这张牌");
    const card = located.card;
    const transformed = input.as === "strike" && card.type !== "strike";
    if (located.zone === "equip" && !transformed) {
      throw new GameRuleError("CARD_NOT_IN_HAND", "手牌中没有这张牌");
    }
    if (transformed && !this.transforms(player.id, card, "strike")) {
      throw new GameRuleError("ILLEGAL_CARD", "这张牌不能当杀使用");
    }

    const definition = this.registry.get(transformed ? "strike" : card.type);
    const normalized =
      definition.normalizeTargets?.(
        this.playContext(player.id, card, input.targets ?? [], input.pick),
      ) ?? input.targets ?? [];
    const check = definition.canPlay(this.playContext(player.id, card, normalized, input.pick));
    if (!check.ok) throw new GameRuleError(check.code, check.reason);

    const before = {
      playerId: player.id,
      card,
      targets: [...normalized],
      cancelled: false,
    };
    this.bus.emit("card:beforePlay", before);
    if (before.cancelled) return;

    const targets = before.targets;
    if (targets.join("|") !== normalized.join("|")) {
      const again = definition.canPlay(this.playContext(player.id, card, targets, input.pick));
      if (!again.ok) throw new GameRuleError(again.code, again.reason);
    }

    this.takeLocated(player, located);
    this.state.processing.push(card);
    this.state.pending = null;
    this.bus.emit("card:played", { playerId: player.id, card, targets });
    const aimed = targets
      .filter((id) => id !== player.id)
      .map((id) => this.state.players.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    if (transformed) {
      this.note(
        aimed.length > 0
          ? `${player.name} 将 ${card.name} 当杀，对 ${aimed.join("、")} 使用了`
          : `${player.name} 将 ${card.name} 当杀使用了`,
      );
    } else {
      this.note(
        aimed.length > 0
          ? `${player.name} 对 ${aimed.join("、")} 使用了 ${card.name}`
          : `${player.name} 使用了 ${card.name}`,
      );
    }
    definition.play(this.playContext(player.id, card, targets, input.pick), this.api);
    this.pump();
  }

  /**
   * 提交当前行动请求。
   * cardId 传 null 表示放弃。倒计时结束时引擎也会用 null 调用这里。
   */
  resolveAction(playerId: string, cardId: string | null): void {
    this.finishResponse(playerId, cardId, false);
  }

  /** 兼容旧调用。不传 cardId 等于 resolveAction(playerId, null)。 */
  respond(input: { playerId: string; cardId?: string }): void {
    this.resolveAction(input.playerId, input.cardId ?? null);
  }

  endPlay(playerId: string): void {
    this.assertStarted();
    this.assertNotOver();
    const pending = this.state.pending;
    if (!pending || pending.kind !== "play" || pending.playerId !== playerId) {
      throw new GameRuleError("NOT_PLAY_WINDOW", "当前不能结束出牌");
    }
    this.state.pending = null;
    this.advancePhase();
    this.pump();
  }

  discard(input: { playerId: string; cardIds: string[] }): void {
    this.assertStarted();
    this.assertNotOver();
    const pending = this.state.pending;
    if (!pending || pending.kind !== "discard" || pending.playerId !== input.playerId) {
      throw new GameRuleError("NOT_DISCARD_WINDOW", "当前不需要弃牌");
    }
    if (input.cardIds.length !== pending.count) {
      throw new GameRuleError("DISCARD_COUNT", `需要弃置 ${pending.count} 张牌`);
    }
    if (new Set(input.cardIds).size !== input.cardIds.length) {
      throw new GameRuleError("DISCARD_COUNT", "弃牌不能重复");
    }

    const player = this.must(input.playerId);
    const cards: Card[] = [];
    for (const cardId of input.cardIds) {
      const index = player.hand.findIndex((card) => card.id === cardId);
      if (index < 0) throw new GameRuleError("CARD_NOT_IN_HAND", "手牌中没有这张牌");
      const [card] = player.hand.splice(index, 1);
      if (card) cards.push(card);
    }
    this.state.discardPile.push(...cards);
    this.bus.emit("card:discarded", {
      playerId: input.playerId,
      cards,
      reason: "hand-limit",
    });
    this.state.pending = null;
    this.advancePhase();
    this.pump();
  }

  /** 出牌窗口里发动主动技能。技能需要监听 skill:invoke 并把 handled 设为 true。 */
  invokeSkill(input: { playerId: string; skillId: string; payload?: unknown }): void {
    this.assertStarted();
    this.assertNotOver();
    const pending = this.state.pending;
    if (!pending || pending.kind !== "play" || pending.playerId !== input.playerId) {
      throw new GameRuleError("NOT_PLAY_WINDOW", "现在不能发动技能");
    }
    if (this.waitStack.length > 0) {
      throw new GameRuleError("BUSY", "还有未结算的效果");
    }
    const player = this.must(input.playerId);
    if (!player.skillIds.includes(input.skillId)) {
      throw new GameRuleError("NO_SKILL", "你没有这个技能");
    }
    const bound = this.boundSkills.find(
      (item) => item.ownerId === input.playerId && item.skill.id === input.skillId && item.skill.phaseAction,
    );
    if (bound?.skill.phaseAction) {
      const handled = bound.skill.phaseAction(input.payload, this.skillHooks(input.playerId));
      if (!handled) throw new GameRuleError("SKILL_UNHANDLED", "这个技能当前不能发动");
      this.pump();
      return;
    }
    const event = {
      playerId: input.playerId,
      skillId: input.skillId,
      payload: input.payload,
      handled: false,
    };
    this.bus.emit("skill:invoke", event);
    if (!event.handled) {
      throw new GameRuleError("SKILL_UNHANDLED", "这个技能当前不能发动");
    }
    this.pump();
  }

  private createApi(): EffectApi {
    return {
      typesFor: (reason) => this.registry.typesFor(reason),
      requestResponse: (request, onResolve) => this.requestResponse(request, onResolve),
      dealDamage: (request, onSettled) => this.dealDamage(request, onSettled),
      applyHeal: (request) => this.applyHeal(request),
      discardProcessed: (cards, reason) => this.discardProcessed(cards, reason),
      markStrikeUsed: (playerId) => {
        this.must(playerId).strikesUsedThisTurn += 1;
      },
      draw: (playerId, count) => {
        const drawn = this.takeCards(playerId, count);
        this.bus.emit("draw:after", {
          playerId,
          count: drawn.length,
          drawn,
          cause: "card",
        });
        return drawn;
      },
      judgeFlip: (playerId, sourceId) => this.judgeFlip(playerId, sourceId),
      discardOwned: (ownerId, cardId) => this.discardOwned(ownerId, cardId),
      discardRandomHand: (ownerId) => this.discardRandomHand(ownerId),
      steal: (fromId, toId, cardId) => this.steal(fromId, toId, cardId),
      equip: (playerId, card) => this.equip(playerId, card),
      placeJudgment: (targetId, card) => this.placeJudgment(targetId, card),
      skipPhase: (playerId, phase) => {
        this.must(playerId).skip[phase] = true;
      },
      livingOthers: (playerId) =>
        this.state.players.filter((player) => player.alive && player.id !== playerId).map((player) => player.id),
      clockwiseOthers: (playerId) => this.clockwiseOthers(playerId),
      name: (playerId) => this.must(playerId).name,
      note: (line) => this.note(line),
      isOver: () => this.state.over,
      emit: (event, payload) => {
        this.bus.emit(event, payload);
      },
    };
  }

  private createPlayer(setup: PlayerSetup): PlayerState {
    const maxHp = setup.maxHp ?? 4;
    const hp = setup.hp ?? maxHp;
    if (!setup.id) throw new GameRuleError("NO_PLAYER", "玩家缺少 id");
    if (maxHp <= 0 || hp <= 0) {
      throw new GameRuleError("BAD_HP", "体力必须大于 0");
    }
    if (hp > maxHp) {
      throw new GameRuleError("BAD_HP", "当前体力不能超过体力上限");
    }
    return {
      id: setup.id,
      name: setup.name || setup.id,
      role: setup.role ?? "unassigned",
      heroId: setup.heroId,
      hp,
      maxHp,
      hand: this.adoptCards(setup.hand),
      equipment: {},
      judgmentZone: [],
      skillIds: [],
      usedSkills: [],
      alive: true,
      strikesUsedThisTurn: 0,
      skip: {},
    };
  }

  private installSkill(playerId: string, skill: HeroSkill): void {
    const player = this.must(playerId);
    if (player.skillIds.includes(skill.id)) {
      throw new GameRuleError("DUPLICATE_SKILL", `技能已存在：${skill.id}`);
    }
    player.skillIds.push(skill.id);
    skill.install(this.skillHooks(playerId));
  }

  private skillHooks(playerId: string): SkillHooks {
    return {
      ownerId: playerId,
      on: (event, listener, priority) => {
        this.bus.on(event, listener, priority);
      },
      getState: () => this.getState(),
      skipPhase: (phase) => {
        this.must(playerId).skip[phase] = true;
      },
      draw: (count) => {
        const drawn = this.takeCards(playerId, count);
        this.bus.emit("draw:after", {
          playerId,
          count: drawn.length,
          drawn,
          cause: "skill",
        });
        return drawn;
      },
      damage: (request) => {
        this.dealDamage(
          {
            sourceId: request.sourceId ?? playerId,
            targetId: request.targetId,
            amount: request.amount,
            nature: request.nature ?? "normal",
            reason: request.reason,
            card: request.card,
          },
          () => undefined,
        );
      },
      heal: (request) => {
        this.applyHeal(request);
      },
      bind: (skill) => {
        this.boundSkills.push({ ownerId: playerId, skill });
      },
      note: (line) => this.note(line),
      gain: (card) => this.gainProcessed(playerId, card),
      discardCards: (cardIds) => this.discardChosen(playerId, cardIds),
      available: (skillId) => !this.must(playerId).usedSkills.includes(skillId),
      spend: (skillId) => {
        const owner = this.must(playerId);
        if (owner.usedSkills.includes(skillId)) return false;
        owner.usedSkills.push(skillId);
        return true;
      },
    };
  }

  private adoptCards(cards: Card[] | undefined): Card[] {
    const cloned = structuredClone(cards ?? []);
    for (const card of cloned) {
      if (!card.id || !card.type) {
        throw new GameRuleError("BAD_CARD", "卡牌缺少 id 或 type");
      }
    }
    return cloned;
  }

  private assertUniqueCards(): void {
    const seen = new Set<string>();
    const cards = [
      ...this.state.deck,
      ...this.state.discardPile,
      ...this.state.processing,
      ...this.state.players.flatMap((player) => [
        ...player.hand,
        ...player.judgmentZone,
        ...this.equipmentCards(player),
      ]),
    ];
    for (const card of cards) {
      if (seen.has(card.id)) {
        throw new GameRuleError("DUPLICATE_CARD", `卡牌 id 重复：${card.id}`);
      }
      seen.add(card.id);
    }
  }

  private equipmentCards(player: PlayerState): Card[] {
    return Object.values(player.equipment).filter((card): card is Card => card !== undefined);
  }

  private transforms(playerId: string, card: Card, asType: string): boolean {
    return this.boundSkills.some(
      (bound) =>
        bound.ownerId === playerId &&
        bound.skill.transformCard?.(card, asType, this.getState(), playerId) === true,
    );
  }

  private locateCard(
    player: PlayerState,
    cardId: string,
  ):
    | { card: Card; zone: "hand"; index: number }
    | { card: Card; zone: "equip"; slot: keyof PlayerState["equipment"] }
    | null {
    const index = player.hand.findIndex((card) => card.id === cardId);
    const handCard = player.hand[index];
    if (handCard) return { card: handCard, zone: "hand", index };
    const slots = ["weapon", "armor", "horseDefensive", "horseOffensive"] as const;
    for (const slot of slots) {
      const card = player.equipment[slot];
      if (card?.id === cardId) return { card, zone: "equip", slot };
    }
    return null;
  }

  private takeLocated(
    player: PlayerState,
    located: { card: Card; zone: "hand"; index: number } | { card: Card; zone: "equip"; slot: keyof PlayerState["equipment"] },
  ): void {
    if (located.zone === "hand") {
      player.hand.splice(located.index, 1);
      return;
    }
    delete player.equipment[located.slot];
  }

  private gainProcessed(playerId: string, card: Card | undefined): boolean {
    if (!card) return false;
    const index = this.state.processing.findIndex((item) => item.id === card.id);
    if (index < 0) return false;
    const [taken] = this.state.processing.splice(index, 1);
    if (!taken) return false;
    this.must(playerId).hand.push(taken);
    return true;
  }

  private discardChosen(playerId: string, cardIds: string[]): number {
    const player = this.must(playerId);
    const unique = [...new Set(cardIds)];
    if (unique.some((cardId) => !this.locateCard(player, cardId))) return 0;
    const cards: Card[] = [];
    for (const cardId of unique) {
      const item = this.locateCard(player, cardId);
      if (!item) return 0;
      this.takeLocated(player, item);
      cards.push(item.card);
    }
    if (cards.length === 0) return 0;
    this.state.discardPile.push(...cards);
    this.bus.emit("card:discarded", { playerId, cards, reason: "skill" });
    return cards.length;
  }

  private shuffleCards(cards: Card[]): void {
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(this.rng() * (index + 1));
      const current = cards[index];
      const other = cards[swap];
      if (!current || !other) continue;
      cards[index] = other;
      cards[swap] = current;
    }
  }

  private assertStarted(): void {
    if (!this.started) throw new GameRuleError("NOT_STARTED", "对局还没开始");
  }

  private assertNotOver(): void {
    if (this.state.over) throw new GameRuleError("GAME_OVER", "对局已结束");
  }

  private must(playerId: string): PlayerState {
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) throw new GameRuleError("NO_PLAYER", `没有玩家 ${playerId}`);
    return player;
  }

  private current(): PlayerState {
    const player = this.state.players[this.state.currentPlayerIndex];
    if (!player) throw new GameRuleError("NO_PLAYER", "没有当前玩家");
    return player;
  }

  private phasePayload(): PhasePayload {
    return {
      playerId: this.current().id,
      phase: this.state.phase,
      turnNumber: this.state.turnNumber,
    };
  }

  private playContext(playerId: string, card: Card, targets: string[], pick?: string): PlayContext {
    return {
      playerId,
      card,
      targets,
      pick,
      state: this.getState(),
      distance: (fromId, toId) => this.getDistance(fromId, toId),
      attackRange: (id) => this.getAttackRange(id),
      strikeLimit: (id) => this.getStrikeLimit(id),
    };
  }

  private respondContext(
    pending: Extract<PendingDecision, { kind: "respond" }>,
    card: Card,
  ): RespondContext {
    return {
      playerId: pending.playerId,
      card,
      reason: pending.reason,
      state: this.getState(),
      sourcePlayerId: pending.sourcePlayerId,
      sourceCardId: pending.sourceCardId,
      dyingPlayerId: pending.dyingPlayerId,
    };
  }

  private finishResponse(playerId: string, cardId: string | null, timedOut: boolean): void {
    this.assertStarted();
    if (this.state.over) throw new GameRuleError("GAME_OVER", "对局已结束");
    const pending = this.state.pending;
    const action = this.state.action;
    if (!pending || pending.kind !== "respond" || pending.playerId !== playerId || !action) {
      throw new GameRuleError("NOT_RESPONSE_WINDOW", "当前没有需要你响应的结算");
    }
    if (action.id !== pending.id || action.playerId !== playerId) {
      throw new GameRuleError("NOT_RESPONSE_WINDOW", "当前没有需要你响应的结算");
    }

    let card: Card | null = null;
    let transformed = false;
    if (!timedOut && cardId) {
      const player = this.must(playerId);
      const located = this.locateCard(player, cardId);
      if (!located) throw new GameRuleError("CARD_NOT_IN_HAND", "手牌中没有这张牌");
      const found = located.card;
      const typeOk = located.zone === "hand" && pending.acceptTypes.includes(found.type);
      transformed =
        pending.acceptTypes.includes("strike") &&
        found.type !== "strike" &&
        this.transforms(playerId, found, "strike");
      if (!typeOk && !transformed) {
        throw new GameRuleError("ILLEGAL_RESPONSE", "这张牌不能这样使用");
      }
      if (!transformed) {
        const definition = this.registry.get(found.type);
        if (definition.canRespond && !definition.canRespond(this.respondContext(pending, found))) {
          throw new GameRuleError("ILLEGAL_RESPONSE", "这张牌不能这样使用");
        }
      }
      this.takeLocated(player, located);
      this.state.processing.push(found);
      card = found;
    } else if (!timedOut && !pending.allowPass) {
      throw new GameRuleError("MUST_RESPOND", "必须打出一张牌");
    }

    const frame = this.waitStack.pop();
    if (!frame || frame.pending.id !== pending.id) {
      throw new GameRuleError("BROKEN_STACK", "结算栈异常");
    }

    this.clearTimer();
    this.state.pending = null;
    this.state.action = null;
    this.state.interaction = "idle";
    if (card) {
      this.bus.emit("card:responded", {
        playerId,
        card,
        reason: pending.reason,
      });
      if (transformed) {
        this.note(`${this.must(playerId).name} 将 ${card.name} 当杀打出了`);
      } else {
        this.registry.get(card.type).respond?.(this.respondContext(pending, card), this.api);
      }
    }
    this.bus.emit("action:resolved", {
      id: action.id,
      playerId,
      cardId: card?.id ?? null,
      timedOut,
      interaction: action.interaction,
    });
    const buried = this.waitStack[this.waitStack.length - 1];
    frame.resolve(card);

    if (this.state.over) {
      this.state.pending = null;
      this.state.action = null;
      this.state.interaction = "idle";
      this.waitStack.length = 0;
      this.clearTimer();
      return;
    }
    const top = this.waitStack[this.waitStack.length - 1];
    if (top && top === buried) {
      this.presentFrame(top);
    }
    this.pump();
  }

  private beginTurnFlags(): void {
    const player = this.current();
    player.strikesUsedThisTurn = 0;
    player.skip = {};
    player.usedSkills = [];
  }

  private pump(): void {
    let guard = 0;
    while (!this.state.over && guard < 64) {
      guard += 1;
      this.syncIdlePending();
      if (this.state.pending) return;
      this.advancePhase();
    }
    if (!this.state.over && !this.state.pending) {
      throw new GameRuleError("PHASE_OVERFLOW", "阶段推进超过上限");
    }
  }

  private syncIdlePending(): void {
    if (this.state.over || this.state.pending) return;
    const top = this.waitStack[this.waitStack.length - 1];
    if (top) {
      this.presentFrame(top);
      return;
    }
    this.state.action = null;
    this.state.interaction = "idle";
    this.clearTimer();
    const player = this.current();
    if (!player.alive || player.skip[this.state.phase]) return;
    if (this.state.phase === "play") {
      this.state.pending = { kind: "play", playerId: player.id };
      return;
    }
    if (this.state.phase === "discard") {
      const count = this.handExcess(player);
      if (count > 0) {
        this.state.pending = { kind: "discard", playerId: player.id, count };
      }
    }
  }

  private handExcess(player: PlayerState): number {
    return Math.max(0, player.hand.length - Math.max(player.hp, 0));
  }

  private advancePhase(): void {
    if (this.state.over) return;
    const leaving = this.phasePayload();
    this.bus.emit("phase:exit", leaving);

    if (this.state.phase === "end") {
      this.bus.emit("turn:end", {
        playerId: leaving.playerId,
        turnNumber: leaving.turnNumber,
      });
      if (this.state.players.filter((player) => player.alive).length <= 1) {
        this.checkGameOver();
        return;
      }
      const next = this.nextAliveIndex(this.state.currentPlayerIndex);
      if (next === null) {
        this.checkGameOver();
        return;
      }
      this.state.currentPlayerIndex = next;
      this.state.turnNumber += 1;
      this.beginTurnFlags();
      this.state.phase = "start";
      this.bus.emit("turn:start", {
        playerId: this.current().id,
        turnNumber: this.state.turnNumber,
      });
    } else {
      this.state.phase = nextPhase(this.state.phase);
    }

    this.bus.emit("phase:enter", this.phasePayload());
    this.runPhaseBody();
  }

  private nextAliveIndex(from: number): number | null {
    const count = this.state.players.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (from + step) % count;
      if (this.state.players[index]?.alive) return index;
    }
    return null;
  }

  private runPhaseBody(): void {
    const player = this.current();
    if (player.skip[this.state.phase]) {
      this.bus.emit("phase:skipped", this.phasePayload());
      return;
    }
    if (this.state.phase === "judge") this.resolveJudgment();
    if (this.state.phase === "draw") this.performDraw();
  }

  private resolveJudgment(): void {
    const player = this.current();
    const cards = [...player.judgmentZone];
    for (const card of cards) {
      const index = player.judgmentZone.findIndex((item) => item.id === card.id);
      if (index < 0) continue;
      const event = { playerId: player.id, card, cancelled: false };
      this.bus.emit("judge:before", event);
      if (event.cancelled) continue;
      player.judgmentZone.splice(index, 1);
      const flip = this.judgeFlip(player.id, card.id);
      this.registry.get(card.type).onJudge?.(
        { playerId: player.id, card, flip },
        this.api,
      );
      this.state.discardPile.push(card);
      this.bus.emit("card:discarded", {
        playerId: player.id,
        cards: [card],
        reason: "judge",
      });
    }
  }

  private performDraw(): void {
    const player = this.current();
    const ctx = {
      playerId: player.id,
      count: 2,
      drawn: [] as Card[],
      cause: "phase" as const,
    };
    this.bus.emit("draw:before", ctx);
    const count = Math.max(0, Math.floor(ctx.count));
    const drawn = this.takeCards(player.id, count);
    ctx.count = count;
    ctx.drawn = drawn;
    this.bus.emit("draw:after", ctx);
  }

  private takeCards(playerId: string, count: number): Card[] {
    const player = this.must(playerId);
    const drawn: Card[] = [];
    for (let index = 0; index < count; index += 1) {
      const card = this.pullFromDeck();
      if (!card) break;
      drawn.push(card);
    }
    player.hand.push(...drawn);
    return drawn;
  }

  private applyHorse(card: Card | undefined, role: "from" | "to", distance: number): number {
    if (!card) return distance;
    return this.registry.get(card.type).modifyDistance?.({ role, distance }) ?? distance;
  }

  private note(line: string): void {
    this.state.log.push(line);
    if (this.state.log.length > 40) {
      this.state.log.splice(0, this.state.log.length - 40);
    }
  }

  private clockwiseOthers(playerId: string): string[] {
    const start = this.state.players.findIndex((player) => player.id === playerId);
    if (start < 0) return [];
    const ids: string[] = [];
    for (let step = 1; step < this.state.players.length; step += 1) {
      const player = this.state.players[(start + step) % this.state.players.length];
      if (player?.alive) ids.push(player.id);
    }
    return ids;
  }

  private judgeFlip(playerId: string, sourceId?: string): Card | null {
    const card = this.pullFromDeck();
    if (!card) return null;
    this.state.discardPile.push(card);
    this.bus.emit("card:discarded", { playerId, cards: [card], reason: "judge" });
    this.bus.emit("judge:flip", { playerId, sourceId, card, hit: card.suit === "heart" || card.suit === "diamond" });
    return card;
  }

  private tryArmorDodge(playerId: string): Card | null {
    const player = this.must(playerId);
    const armor = player.equipment.armor;
    if (!armor) return null;
    const negate = this.registry.get(armor.type).negateDodge;
    if (!negate) return null;
    const flip = this.judgeFlip(playerId, armor.id);
    if (!flip) return null;
    const hit = negate(flip);
    this.note(
      hit
        ? `${player.name} 的八卦阵判定为红色，抵消了这次攻击`
        : `${player.name} 的八卦阵判定未成，仍需出闪`,
    );
    return hit ? flip : null;
  }

  private removeOwned(ownerId: string, cardId: string): Card | null {
    const player = this.must(ownerId);
    const handIndex = player.hand.findIndex((card) => card.id === cardId);
    if (handIndex >= 0) {
      const [card] = player.hand.splice(handIndex, 1);
      return card ?? null;
    }
    const judgeIndex = player.judgmentZone.findIndex((card) => card.id === cardId);
    if (judgeIndex >= 0) {
      const [card] = player.judgmentZone.splice(judgeIndex, 1);
      return card ?? null;
    }
    const slots = ["weapon", "armor", "horseDefensive", "horseOffensive"] as const;
    for (const slot of slots) {
      if (player.equipment[slot]?.id !== cardId) continue;
      const card = player.equipment[slot];
      player.equipment[slot] = undefined;
      return card ?? null;
    }
    return null;
  }

  private discardOwned(ownerId: string, cardId: string): Card | null {
    const card = this.removeOwned(ownerId, cardId);
    if (!card) return null;
    this.state.discardPile.push(card);
    this.bus.emit("card:discarded", { playerId: ownerId, cards: [card], reason: "removed" });
    return card;
  }

  private discardRandomHand(ownerId: string): Card | null {
    const hand = this.must(ownerId).hand;
    if (hand.length === 0) return null;
    const card = hand[Math.floor(this.rng() * hand.length)];
    if (!card) return null;
    return this.discardOwned(ownerId, card.id);
  }

  private steal(fromId: string, toId: string, cardId: string | null): Card | null {
    let id = cardId;
    if (!id) {
      const hand = this.must(fromId).hand;
      if (hand.length === 0) return null;
      id = hand[Math.floor(this.rng() * hand.length)]?.id ?? null;
    }
    if (!id) return null;
    const card = this.removeOwned(fromId, id);
    if (!card) return null;
    this.must(toId).hand.push(card);
    return card;
  }

  private equip(playerId: string, card: Card): void {
    const key =
      card.slot === "weapon"
        ? "weapon"
        : card.slot === "armor"
          ? "armor"
          : card.slot === "horse-plus"
            ? "horseDefensive"
            : card.slot === "horse-minus"
              ? "horseOffensive"
              : null;
    if (!key) throw new GameRuleError("BAD_CARD", "这张牌不能装备");
    const index = this.state.processing.findIndex((item) => item.id === card.id);
    if (index >= 0) this.state.processing.splice(index, 1);
    const player = this.must(playerId);
    const previous = player.equipment[key];
    if (previous) {
      this.state.discardPile.push(previous);
      this.bus.emit("card:discarded", { playerId, cards: [previous], reason: "replace" });
    }
    player.equipment[key] = card;
  }

  private placeJudgment(targetId: string, card: Card): void {
    const index = this.state.processing.findIndex((item) => item.id === card.id);
    if (index >= 0) this.state.processing.splice(index, 1);
    this.must(targetId).judgmentZone.push(card);
  }

  private pullFromDeck(): Card | undefined {
    this.recycleDiscardIntoDeck();
    return this.state.deck.shift();
  }

  private recycleDiscardIntoDeck(): void {
    if (this.state.deck.length > 0 || this.state.discardPile.length === 0) return;
    const cards = this.state.discardPile.splice(0, this.state.discardPile.length);
    if (this.shuffleOnRecycle) this.shuffleCards(cards);
    this.state.deck = cards;
    this.bus.emit("deck:reshuffled", { count: cards.length });
  }

  private requestResponse(
    request: ResponseRequest,
    resolve: (card: Card | null) => void,
  ): void {
    if (this.state.over) {
      resolve(null);
      return;
    }
    if (request.reason === "dodge") {
      const flip = this.tryArmorDodge(request.playerId);
      if (flip) {
        resolve(flip);
        return;
      }
    }
    this.bus.emit("response:open", request);
    this.responseSeq += 1;
    const now = this.clock.now();
    const interaction = request.reason === "dying" ? "DYING" : "WAITING_RESPONSE";
    const pending: Extract<PendingDecision, { kind: "respond" }> = {
      kind: "respond",
      id: `resp_${this.responseSeq}`,
      playerId: request.playerId,
      reason: request.reason,
      acceptTypes: [...request.acceptTypes],
      allowPass: request.allowPass,
      timeoutMs: ACTION_TIMEOUT_MS,
      expiresAt: now + ACTION_TIMEOUT_MS,
      sourcePlayerId: request.sourcePlayerId,
      sourceCardId: request.sourceCardId,
      dyingPlayerId: request.dyingPlayerId,
    };
    const action: ActionRequest = {
      id: pending.id,
      playerId: pending.playerId,
      interaction,
      acceptTypes: [...pending.acceptTypes],
      allowPass: pending.allowPass,
      timeoutMs: ACTION_TIMEOUT_MS,
      startedAt: now,
      expiresAt: pending.expiresAt,
      remainingMs: ACTION_TIMEOUT_MS,
      sourcePlayerId: pending.sourcePlayerId,
      sourceCardId: pending.sourceCardId,
      dyingPlayerId: pending.dyingPlayerId,
      followingPlayerIds: [...(request.followingPlayerIds ?? [])],
    };
    const frame = { pending, action, resolve };
    this.waitStack.push(frame);
    this.presentFrame(frame);
    this.bus.emit("action:requested", structuredClone(action));
  }

  private presentFrame(frame: WaitFrame): void {
    this.state.pending = frame.pending;
    this.state.action = frame.action;
    this.state.interaction = frame.action.interaction;
    this.armTimer(frame.action);
  }

  private armTimer(action: ActionRequest): void {
    this.clearTimer();
    const delay = Math.max(0, action.expiresAt - this.clock.now());
    this.armedActionId = action.id;
    this.timer = this.clock.setTimeout(() => {
      if (this.armedActionId !== action.id) return;
      this.timer = null;
      this.armedActionId = null;
      if (this.state.over || this.state.action?.id !== action.id) return;
      this.finishResponse(action.playerId, null, true);
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer != null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.armedActionId = null;
  }

  private dealDamage(request: DamageRequest, onSettled: () => void): void {
    const ctx = {
      sourceId: request.sourceId,
      targetId: request.targetId,
      amount: request.amount,
      nature: request.nature ?? "normal",
      card: request.card,
      reason: request.reason,
      prevented: false,
    };
    this.bus.emit("damage:before", ctx);
    if (ctx.prevented || ctx.amount <= 0) {
      this.bus.emit("damage:prevented", ctx);
      onSettled();
      return;
    }
    const target = this.must(ctx.targetId);
    if (!target.alive) {
      onSettled();
      return;
    }
    target.hp -= ctx.amount;
    this.bus.emit("damage:dealt", ctx);
    this.note(`${target.name} 受到 ${ctx.amount} 点伤害`);
    for (const bound of this.boundSkills) {
      if (bound.ownerId !== ctx.targetId || !bound.skill.afterDamage) continue;
      bound.skill.afterDamage(ctx, this.skillHooks(bound.ownerId));
    }
    this.bus.emit("hp:changed", {
      playerId: target.id,
      hp: target.hp,
      maxHp: target.maxHp,
      delta: -ctx.amount,
      cause: "damage",
    });
    if (target.alive && target.hp <= 0) {
      this.resolveDying(
        target.id,
        onSettled,
        request.sourceId,
        request.card?.id,
      );
      return;
    }
    onSettled();
  }

  private resolveDying(
    playerId: string,
    done: () => void,
    sourcePlayerId?: string,
    sourceCardId?: string,
  ): void {
    const source = { sourcePlayerId, sourceCardId };
    this.bus.emit("player:dying", { playerId, hp: this.must(playerId).hp });
    this.askDying(playerId, this.clockwiseResponders(playerId), source, done);
  }

  /** 从濒死者的座位开始，沿玩家数组顺时针问仍在场上的人。 */
  private clockwiseResponders(startId: string): string[] {
    const start = this.state.players.findIndex((player) => player.id === startId);
    if (start < 0) return [];
    const ids: string[] = [];
    for (let step = 0; step < this.state.players.length; step += 1) {
      const player = this.state.players[(start + step) % this.state.players.length];
      if (player?.alive) ids.push(player.id);
    }
    return ids;
  }

  private askDying(
    dyingId: string,
    queue: string[],
    source: { sourcePlayerId?: string; sourceCardId?: string },
    done: () => void,
  ): void {
    const dying = this.must(dyingId);
    if (this.state.over || !dying.alive || dying.hp > 0) {
      done();
      return;
    }
    const [playerId, ...rest] = queue;
    if (!playerId) {
      this.kill(dyingId);
      done();
      return;
    }
    if (!this.must(playerId).alive) {
      this.askDying(dyingId, rest, source, done);
      return;
    }
    this.requestResponse(
      {
        playerId,
        reason: "dying",
        acceptTypes: this.registry.typesFor("dying"),
        allowPass: true,
        sourcePlayerId: source.sourcePlayerId,
        sourceCardId: source.sourceCardId,
        dyingPlayerId: dyingId,
        followingPlayerIds: rest,
      },
      (card) => {
        if (card) {
          this.discardProcessed([card], "used");
          const current = this.must(dyingId);
          if (this.state.over || !current.alive || current.hp > 0) {
            done();
            return;
          }
          this.askDying(dyingId, this.clockwiseResponders(dyingId), source, done);
          return;
        }
        this.askDying(dyingId, rest, source, done);
      },
    );
  }

  private applyHeal(request: HealRequest): void {
    const ctx = {
      sourceId: request.sourceId,
      targetId: request.targetId,
      amount: request.amount,
      card: request.card,
      prevented: false,
    };
    this.bus.emit("heal:before", ctx);
    const target = this.must(ctx.targetId);
    if (ctx.prevented || ctx.amount <= 0 || !target.alive) return;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + ctx.amount);
    this.bus.emit("heal:after", ctx);
    const delta = target.hp - before;
    if (delta !== 0) {
      this.note(`${target.name} 回复了 ${delta} 点体力`);
      this.bus.emit("hp:changed", {
        playerId: target.id,
        hp: target.hp,
        maxHp: target.maxHp,
        delta,
        cause: "heal",
      });
    }
  }

  private discardProcessed(cards: Card[], reason: string): void {
    const moved: Card[] = [];
    for (const card of cards) {
      const index = this.state.processing.findIndex((item) => item.id === card.id);
      if (index < 0) continue;
      const [removed] = this.state.processing.splice(index, 1);
      if (!removed) continue;
      this.state.discardPile.push(removed);
      moved.push(removed);
    }
    if (moved.length > 0) {
      this.bus.emit("card:discarded", { cards: moved, reason });
    }
  }

  private takeHandCard(playerId: string, cardId: string): Card {
    const player = this.must(playerId);
    const index = player.hand.findIndex((card) => card.id === cardId);
    if (index < 0) throw new GameRuleError("CARD_NOT_IN_HAND", "手牌中没有这张牌");
    const [card] = player.hand.splice(index, 1);
    if (!card) throw new GameRuleError("CARD_NOT_IN_HAND", "手牌中没有这张牌");
    this.state.processing.push(card);
    return card;
  }

  private kill(playerId: string): void {
    const player = this.must(playerId);
    if (!player.alive) return;
    player.alive = false;
    const cards = [
      ...player.hand,
      ...player.judgmentZone,
      ...this.equipmentCards(player),
    ];
    player.hand = [];
    player.judgmentZone = [];
    player.equipment = {};
    if (cards.length > 0) {
      this.state.discardPile.push(...cards);
      this.bus.emit("card:discarded", { playerId, cards, reason: "death" });
    }
    this.note(`${player.name} 阵亡`);
    this.bus.emit("player:died", { playerId });
    this.checkGameOver();
  }

  private checkGameOver(): boolean {
    if (this.state.over) return true;
    const custom = this.winChecker?.(this.getState());
    if (custom?.over) {
      this.finishGame(custom.winners, custom.reason ?? "custom");
      return true;
    }
    const alive = this.state.players.filter((player) => player.alive);
    if (alive.length <= 1) {
      this.finishGame(
        alive.map((player) => player.id),
        "last-alive",
      );
      return true;
    }
    return false;
  }

  private finishGame(winners: string[], reason: string): void {
    if (this.state.over) return;
    this.state.over = true;
    this.state.winners = [...winners];
    this.state.winReason = reason;
    this.state.pending = null;
    this.state.action = null;
    this.state.interaction = "idle";
    this.waitStack.length = 0;
    this.clearTimer();
    this.bus.emit("game:over", { winners: [...this.state.winners], reason });
  }
}
