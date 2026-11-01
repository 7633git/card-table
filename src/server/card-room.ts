import { Client, Room, ServerError } from "@colyseus/core";
import { GameEngine } from "../engine/game-engine.js";
import { GameRuleError } from "../errors.js";
import type { Role } from "../model/player.js";
import { identityWin, openingVitals } from "../rules/identity.js";
import { HEROES, createHeroSkill, heroById, skillById } from "../skills/characters.js";
import { chooseBotAction } from "./bot.js";
import { applyCommand, readCommand } from "./commands.js";
import { buildDeck, deal } from "./deck.js";
import { viewFor, type SeatInfo } from "./view.js";

export const ROOM_NAME = "card";
const RECONNECT_SECONDS = 30;
/** 客户端主动 room.leave() 时的关闭码。这种离开不占着重连名额。 */
const CONSENTED_CLOSE = 4000;
const OPENING_HAND = 4;
const BOT_DELAY_MIN = 800;
const BOT_DELAY_SPAN = 700;

export interface CardRoomOptions {
  seats?: number;
  /** 单机：只坐一个人，另一席由房间里的对手自动出牌。 */
  solo?: boolean;
  /** 四人身份局。只有一名真人时，另外三席由电脑补上。 */
  identity?: boolean;
}

interface Seat {
  sessionId: string;
  playerId: string;
  name: string;
  connected: boolean;
  bot?: boolean;
  role?: Role;
  heroId?: string;
}

/**
 * 一桌牌。引擎只活在服务器上。
 * 每个连接只收到自己的手牌；倒计时仍由引擎的系统时钟推进。
 */
export class CardRoom extends Room {
  private seatLimit = 2;
  private seats: Seat[] = [];
  private engine: GameEngine | null = null;
  private started = false;
  private alive = true;
  private pushScheduled = false;
  private unsubscribers: Array<() => void> = [];
  private solo = false;
  private identity = false;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

  onCreate(options: CardRoomOptions = {}) {
    this.identity = options.identity === true;
    this.solo = options.solo === true && !this.identity;
    this.seatLimit = this.identity ? 4 : this.solo ? 2 : clampSeats(options.seats);
    this.maxClients = this.identity || this.solo ? 1 : this.seatLimit;
    this.onMessage("sync", (client) => this.sendSnapshot(client));
    this.onMessage("play", (client, payload) => this.handle(client, "play", payload));
    this.onMessage("resolve", (client, payload) => this.handle(client, "resolve", payload));
    this.onMessage("endPlay", (client, payload) => this.handle(client, "endPlay", payload));
    this.onMessage("discard", (client, payload) => this.handle(client, "discard", payload));
    this.onMessage("invokeSkill", (client, payload) => this.handle(client, "invokeSkill", payload));
    this.onMessage("chooseHero", (client, payload) => this.chooseHero(client, payload));
    this.onMessage("rematch", (client) => this.rematch(client));
    void this.refreshListing();
  }

  onJoin(client: Client, options: { name?: unknown } = {}) {
    if (this.started) {
      throw new ServerError(400, "对局已经开始");
    }
    this.seats.push({
      sessionId: client.sessionId,
      playerId: `p${this.seats.length + 1}`,
      name: seatName(options.name, this.seats.length + 1),
      connected: true,
    });
    if (this.identity) {
      const human = this.seats.find((seat) => seat.sessionId === client.sessionId);
      if (human) human.role = "lord";
      this.fillIdentityBots(client.sessionId);
    } else if (this.solo) {
      this.seats.push({
        sessionId: `bot-${client.sessionId}`,
        playerId: `p${this.seats.length + 1}`,
        name: "对手",
        connected: true,
        bot: true,
      });
    }
    this.pushLobby();
    void this.refreshListing();
    if (!this.identity && this.seats.length >= this.seatLimit) {
      this.beginMatch();
    }
  }

  async onLeave(client: Client, code?: number) {
    const seat = this.seats.find((item) => item.sessionId === client.sessionId);
    if (!seat) return;
    if (!this.started) {
      this.seats = this.seats.filter((item) => item !== seat);
      this.seats.forEach((item, index) => {
        item.playerId = `p${index + 1}`;
      });
      this.pushLobby();
      void this.refreshListing();
      return;
    }
    seat.connected = false;
    this.schedulePush();
    if (code === CONSENTED_CLOSE) return;
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      seat.connected = true;
      this.schedulePush();
    } catch {
      seat.connected = false;
      this.schedulePush();
    }
  }

  onDispose() {
    this.alive = false;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  private beginMatch() {
    if (this.started) return;
    this.started = true;
    void this.lock();
    const deck = buildDeck(this.seats.length);
    const hands = deal(deck, this.seats.length, OPENING_HAND);
    const engine = GameEngine.create({
      players: this.seats.map((seat, index) => {
        const hero = seat.heroId ? heroById(seat.heroId) : undefined;
        const vitals = openingVitals(hero?.maxHp ?? 4, seat.role);
        return {
          id: seat.playerId,
          name: seat.name,
          role: seat.role,
          heroId: hero?.id,
          hp: vitals.hp,
          maxHp: vitals.maxHp,
          hand: hands[index] ?? [],
          skills: hero ? [createHeroSkill(hero.skillId)] : [],
        };
      }),
      deck,
      shuffle: true,
      winChecker: this.identity ? identityWin : undefined,
    });
    this.engine = engine;
    this.bindEngine(engine);
    engine.start();
    this.schedulePush();
    void this.refreshListing();
  }

  private bindEngine(engine: GameEngine) {
    const events = [
      "phase:enter",
      "turn:start",
      "draw:after",
      "card:played",
      "card:discarded",
      "action:requested",
      "action:resolved",
      "damage:dealt",
      "damage:prevented",
      "hp:changed",
      "player:died",
      "game:over",
    ] as const;
    for (const event of events) {
      this.unsubscribers.push(engine.on(event, () => this.schedulePush()));
    }
  }

  private handle(client: Client, type: string, payload: unknown) {
    if (!this.engine || !this.started) {
      client.send("error", { code: "NOT_STARTED", message: "对局还没开始" });
      return;
    }
    const seat = this.seatFor(client);
    if (!seat) {
      client.send("error", { code: "NO_SEAT", message: "你不在这桌" });
      return;
    }
    const command = readCommand(type, payload);
    if ("error" in command) {
      client.send("error", { code: "BAD_MESSAGE", message: command.error });
      return;
    }
    try {
      applyCommand(this.engine, seat.playerId, command);
    } catch (error) {
      if (error instanceof GameRuleError) {
        client.send("error", { code: error.code, message: error.message });
        return;
      }
      throw error;
    }
    this.schedulePush();
  }

  private sendSnapshot(client: Client) {
    if (!this.started || !this.engine) {
      client.send("lobby", this.lobbyPayload());
      return;
    }
    const seat = this.seatFor(client);
    if (!seat) return;
    client.send(
      "state",
      viewFor(
        this.engine.getState(),
        seat.playerId,
        this.seatInfos(),
        this.engine.legalPlays(seat.playerId),
        this.engine.legalAnswers(seat.playerId),
      ),
    );
  }

  private schedulePush() {
    if (!this.alive || this.pushScheduled) return;
    this.pushScheduled = true;
    queueMicrotask(() => {
      this.pushScheduled = false;
      this.pushViews();
    });
  }

  private pushViews() {
    if (!this.alive || !this.engine) return;
    const state = this.engine.getState();
    const seats = this.seatInfos();
    for (const client of this.clients) {
      const seat = this.seatFor(client);
      if (!seat) continue;
      client.send(
        "state",
        viewFor(state, seat.playerId, seats, this.engine.legalPlays(seat.playerId), this.engine.legalAnswers(seat.playerId)),
      );
    }
    this.scheduleBot();
  }

  private scheduleBot() {
    if (!this.alive || this.botTimer || !this.seats.some((seat) => seat.bot)) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.runBot();
    }, BOT_DELAY_MIN + Math.floor(Math.random() * BOT_DELAY_SPAN));
  }

  private runBot() {
    if (!this.alive || !this.engine) return;
    for (const seat of this.seats) {
      if (!seat.bot) continue;
      const command = chooseBotAction(this.engine, seat.playerId);
      if (!command) continue;
      try {
        applyCommand(this.engine, seat.playerId, command);
      } catch (error) {
        if (error instanceof GameRuleError) return;
        throw error;
      }
      this.schedulePush();
      return;
    }
  }

  private fillIdentityBots(sessionId: string) {
    const specs: Array<{ role: Role; name: string }> = [
      { role: "loyalist", name: "Bot-忠臣" },
      { role: "rebel", name: "Bot-反贼" },
      { role: "spy", name: "Bot-内奸" },
    ];
    for (const spec of specs) {
      this.seats.push({
        sessionId: `bot-${sessionId}-${spec.role}`,
        playerId: `p${this.seats.length + 1}`,
        name: spec.name,
        connected: true,
        bot: true,
        role: spec.role,
      });
    }
  }

  private chooseHero(client: Client, payload: unknown) {
    if (!this.identity || this.started) return;
    const heroId = typeof payload === "object" && payload !== null ? (payload as { heroId?: unknown }).heroId : undefined;
    const hero = typeof heroId === "string" ? heroById(heroId) : undefined;
    const seat = this.seatFor(client);
    if (!seat || seat.bot || !hero) {
      client.send("error", { code: "BAD_HERO", message: "选一个在座的武将" });
      return;
    }
    seat.heroId = hero.id;
    seat.role = "lord";
    const rest = HEROES.filter((item) => item.id !== hero.id);
    for (let index = rest.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      const current = rest[index];
      const other = rest[swap];
      if (!current || !other) continue;
      rest[index] = other;
      rest[swap] = current;
    }
    for (const bot of this.seats.filter((item) => item.bot)) {
      const next = rest.pop();
      if (next) bot.heroId = next.id;
    }
    this.beginMatch();
  }

  private rematch(client: Client) {
    if (!this.identity || !this.seatFor(client) || !this.engine?.getState().over) return;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.engine = null;
    this.started = false;
    for (const seat of this.seats) seat.heroId = undefined;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.pushLobby();
    void this.refreshListing();
  }

  private pushLobby() {
    const lobby = this.lobbyPayload();
    for (const client of this.clients) client.send("lobby", lobby);
  }

  private lobbyPayload() {
    return {
      roomId: this.roomId,
      seats: this.seatLimit,
      started: this.started,
      solo: this.solo || this.identity,
      identity: this.identity,
      picking: this.identity && !this.started,
      heroes: this.identity
        ? HEROES.map((hero) => {
            const skill = skillById(hero.skillId);
            return {
              id: hero.id,
              name: hero.name,
              maxHp: hero.maxHp,
              skillName: skill?.name ?? "",
              skillText: skill?.description ?? "",
            };
          })
        : [],
      players: this.seats.map((seat) => ({
        playerId: seat.playerId,
        name: seat.name,
        connected: seat.connected,
      })),
    };
  }

  private seatInfos(): SeatInfo[] {
    return this.seats.map((seat) => ({
      playerId: seat.playerId,
      name: seat.name,
      connected: seat.connected,
    }));
  }

  private seatFor(client: Client): Seat | undefined {
    return this.seats.find((seat) => seat.sessionId === client.sessionId);
  }

  private async refreshListing() {
    try {
      await this.setMetadata({
        seats: this.seatLimit,
        seated: this.seats.length,
        started: this.started,
      });
    } catch {
      // 房间还没登记进匹配列表时，跳过这次更新。
    }
  }
}

function clampSeats(value: unknown): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 2;
  return Math.min(8, Math.max(2, parsed));
}

export function seatName(input: unknown, index: number): string {
  const fallback = `玩家${index}`;
  if (typeof input !== "string") return fallback;
  const cleaned = input.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 16);
  return cleaned || fallback;
}
