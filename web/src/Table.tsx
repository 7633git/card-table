import { useEffect, useRef, useState } from "react";
import { CardBack, CardFace, Magatama } from "./CardFace.js";
import { diffReveals, type Flight, type HpPulse, type Reveal } from "./diff.js";
import type { Card, ClientView, LobbyView, PublicPlayer } from "./protocol.js";
import { playerName } from "./protocol.js";

interface Clock {
  remainingMs: number;
  at: number;
}

interface TableProps {
  lobby: LobbyView | null;
  view: ClientView | null;
  clock: Clock | null;
  error: string;
  flights: Flight[];
  pulses: HpPulse[];
  onSend: (type: string, payload?: unknown) => void;
  onLeave: () => void;
  onRematch: () => void;
  onFlightDone: (key: string) => void;
  onPulseDone: (key: string) => void;
}

const ROLE_MARK: Record<string, string> = {
  lord: "主",
  loyalist: "忠",
  rebel: "反",
  spy: "内",
  unassigned: "客",
};

export function Table(props: TableProps) {
  const { view, lobby } = props;
  const [aimId, setAimId] = useState<string | null>(null);
  const [aimAs, setAimAs] = useState<"strike" | null>(null);
  const [discardIds, setDiscardIds] = useState<string[]>([]);
  const [zhiheng, setZhiheng] = useState(false);
  const [zhihengIds, setZhihengIds] = useState<string[]>([]);
  const [reveals, setReveals] = useState<Reveal[]>([]);
  const logRef = useRef<HTMLOListElement | null>(null);
  const viewRef = useRef<ClientView | null>(null);

  useEffect(() => {
    setAimId(null);
    setAimAs(null);
    setDiscardIds([]);
    setZhiheng(false);
    setZhihengIds([]);
  }, [view?.action?.id, view?.pending?.kind, view?.phase, view?.currentPlayerId]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [view?.log?.length]);

  useEffect(() => {
    const mine = view?.players.find((player) => player.id === view.you);
    const skill = mine?.skills?.find((item) => item.id === "zhiheng");
    if (skill && !skill.usable) {
      setZhiheng(false);
      setZhihengIds([]);
    }
  }, [view]);

  useEffect(() => {
    const prev = viewRef.current;
    viewRef.current = view;
    if (!prev || !view) return;
    const arrived = diffReveals(prev, view);
    if (arrived.length === 0) return;
    setReveals((current) => [...current, ...arrived].slice(-8));
  }, [view]);

  useEffect(() => {
    if (reveals.length === 0) return;
    const timer = window.setTimeout(() => {
      setReveals((current) => current.slice(1));
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [reveals]);

  if (!view) {
    if (lobby?.picking) {
      return (
        <main className="felt-app mx-auto flex w-full max-w-3xl flex-col justify-center px-6 py-10">
          <h1 className="m-0 font-[family-name:var(--font-card)] text-5xl text-lamp">选择武将</h1>
          <p className="mt-4 max-w-[40ch] text-lg">你是主公，体力上限加 1。另外三席是忠臣、反贼和内奸。</p>
          <div className="hero-pick">
            {(lobby.heroes ?? []).map((hero) => (
              <button
                key={hero.id}
                type="button"
                className="hero-pick-item"
                onClick={() => props.onSend("chooseHero", { heroId: hero.id })}
              >
                <span className="hero-pick-name">{hero.name}</span>
                <span className="hero-pick-skill">
                  {hero.skillName} · {hero.maxHp} 体力
                </span>
                <span className="hero-pick-text">{hero.skillText}</span>
              </button>
            ))}
          </div>
          {props.error ? <p className="m-0 text-cinnabar">{props.error}</p> : null}
          <button className="mt-8 w-fit rounded-md px-3 py-2 text-ash" type="button" onClick={props.onLeave}>
            离开
          </button>
        </main>
      );
    }
    const seated = lobby?.players.length ?? 0;
    const missing = Math.max(0, (lobby?.seats ?? seated) - seated);
    return (
      <main className="felt-app mx-auto flex w-full max-w-3xl flex-col justify-center px-6">
        <h1 className="m-0 font-[family-name:var(--font-card)] text-5xl text-lamp">{lobby?.roomId}</h1>
        <p className="mt-4 max-w-[36ch] text-lg">
          {missing > 0 ? `把房间号发给同桌。还差 ${missing} 人就开局。` : "人齐了，正在发牌。"}
        </p>
        <ul className="mt-6 flex flex-wrap gap-3 p-0">
          {lobby?.players.map((player) => (
            <li key={player.playerId} className="seat list-none">
              {player.name}
            </li>
          ))}
        </ul>
        <button className="mt-8 w-fit rounded-md px-3 py-2 text-ash" type="button" onClick={props.onLeave}>
          离开
        </button>
      </main>
    );
  }

  const me = view.players.find((player) => player.id === view.you);
  const others = view.players.filter((player) => player.id !== view.you);
  const plays = view.plays ?? [];
  const aimed =
    plays.find((play) => play.cardId === aimId && (aimAs ? play.as === "strike" : !play.as)) ?? null;
  const aimedCard = me?.hand?.find((card) => card.id === aimId) ?? null;
  const myTurn = view.currentPlayerId === view.you && view.interaction === "idle" && view.phase === "play" && !view.over;
  const answering = view.action?.playerId === view.you;
  const discarding = view.pending?.kind === "discard" && view.pending.playerId === view.you;
  const discardNeed = view.pending?.kind === "discard" ? view.pending.count : 0;
  const flying = new Set(props.flights.map((flight) => flight.card.id));
  let latest: Card | null = null;
  for (const card of [...view.processing, ...view.discardPile]) {
    if (!flying.has(card.id)) latest = card;
  }
  const flank = others.length === 2;

  const over = view.over;
  const acceptTypes = view.action?.acceptTypes ?? [];
  const selectedPlays = plays.filter((play) => play.cardId === aimId);
  const directPlay = selectedPlays.find((play) => !play.as && play.targets.length === 0);
  const strikePlay = selectedPlays.find((play) => play.as === "strike");
  function playable(card: Card): boolean {
    if (over) return false;
    if (zhiheng) return true;
    if (answering) {
      if (view?.answers) return view.answers.includes(card.id);
      return acceptTypes.includes(card.type);
    }
    if (discarding) return true;
    if (!myTurn) return false;
    return plays.some((play) => play.cardId === card.id);
  }

  function toggleZhiheng(cardId: string) {
    setZhihengIds((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
    );
  }

  function onCard(card: Card) {
    if (!view || !playable(card)) return;
    if (zhiheng) {
      toggleZhiheng(card.id);
      return;
    }
    if (answering) {
      props.onSend("resolve", { cardId: card.id });
      return;
    }
    if (discarding) {
      setDiscardIds((current) =>
        current.includes(card.id) ? current.filter((id) => id !== card.id) : [...current, card.id],
      );
      return;
    }
    const options = plays.filter((item) => item.cardId === card.id);
    const direct = options.find((item) => !item.as && item.targets.length === 0);
    const aimedOptions = options.filter((item) => item.targets.length > 0);
    if (direct && aimedOptions.length === 0) {
      props.onSend("play", { cardId: card.id, targets: [] });
      setAimId(null);
      setAimAs(null);
      return;
    }
    setAimId(card.id);
    const only = aimedOptions.length === 1 ? aimedOptions[0] : undefined;
    setAimAs(!direct && only?.as === "strike" ? "strike" : null);
  }

  function onArm(cardId: string) {
    if (zhiheng) {
      toggleZhiheng(cardId);
      return;
    }
    if (answering) {
      props.onSend("resolve", { cardId });
      return;
    }
    setAimId(cardId);
    setAimAs("strike");
  }

  function onSeat(player: PublicPlayer, pick?: string) {
    if (!view || !aimed || !aimedCard || !player.alive || player.id === view.you) return;
    if (!aimed.targets.includes(player.id)) return;
    const stealing = !aimAs && (aimedCard.type === "dismantle" || aimedCard.type === "snatch");
    if (stealing && !pick && player.handCount === 0) return;
    props.onSend("play", {
      cardId: aimed.cardId,
      targets: [player.id],
      pick,
      as: aimAs ?? undefined,
    });
    setAimId(null);
    setAimAs(null);
  }

  const prompt = zhiheng ? "点选要弃掉的手牌和装备" : lineFor(view, aimedCard, aimAs);
  const armIds = [
    ...plays.filter((play) => play.as === "strike").map((play) => play.cardId),
    ...(answering ? view.answers ?? [] : []),
  ].filter((id) => !(me?.hand ?? []).some((card) => card.id === id));

  return (
    <main className="felt-app flex min-h-svh flex-col px-3 py-3 sm:px-5">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="m-0 font-[family-name:var(--font-card)] text-3xl text-lamp">牌桌</h1>
          <span>第 {view.turnNumber} 回合</span>
          <span>{view.phaseLabel}</span>
          <span className="text-ash">{lobby?.identity ? "身份局" : lobby?.solo ? "单机" : `房间 ${lobby?.roomId ?? ""}`}</span>
        </div>
        <button className="rounded-md px-3 py-2 text-ash" type="button" onClick={props.onLeave}>
          离开
        </button>
      </header>

      <div className="board min-h-0 flex-1">
        <div className="arena">
          {flank ? (
            <div className="flank">
              <Seat
                player={others[0]!}
                active={others[0]?.id === view.currentPlayerId}
                acting={reveals.some((reveal) => reveal.actor === others[0]?.name)}
                legal={Boolean(aimed?.targets.includes(others[0]?.id ?? ""))}
                stealing={!aimAs && (aimedCard?.type === "dismantle" || aimedCard?.type === "snatch")}
                pulse={props.pulses.find((item) => item.playerId === others[0]?.id)}
                onPulseDone={props.onPulseDone}
                onChoose={(pick) => others[0] && onSeat(others[0], pick)}
              />
            </div>
          ) : (
            <div className="ring-top">
              {others.map((player) => (
                <Seat
                  key={player.id}
                  player={player}
                  active={player.id === view.currentPlayerId}
                  acting={reveals.some((reveal) => reveal.actor === player.name)}
                  legal={Boolean(aimed?.targets.includes(player.id))}
                  stealing={!aimAs && (aimedCard?.type === "dismantle" || aimedCard?.type === "snatch")}
                  pulse={props.pulses.find((item) => item.playerId === player.id)}
                  onPulseDone={props.onPulseDone}
                  onChoose={(pick) => onSeat(player, pick)}
                />
              ))}
            </div>
          )}

          <section className={`felt-center ${flank ? "" : "is-full"}`} data-table-center>
            <div className="flex items-end gap-6">
              <Pile label="牌堆" count={view.deckCount} />
              {reveals.length > 0 ? (
                <div className="reveal-row">
                  {reveals.slice(0, 3).map((reveal) => (
                    <figure key={reveal.key} className="reveal">
                      <figcaption className="reveal-actor">{reveal.actor}</figcaption>
                      {reveal.card ? (
                        <div className="reveal-face">
                          <CardFace card={reveal.card} />
                        </div>
                      ) : (
                        <p className="reveal-skill">{reveal.line}</p>
                      )}
                      {reveal.card ? <p className="reveal-line">{reveal.line}</p> : null}
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="h-[134px] w-24">
                  {latest ? <CardFace card={latest} /> : <p className="m-0 text-center text-ash">还没有人出牌</p>}
                </div>
              )}
              <Pile label="弃牌" count={view.discardPile.length} />
            </div>
            <p className="m-0 text-center font-[family-name:var(--font-card)] text-2xl text-lamp">{prompt}</p>
            {view.log?.length ? (
              <p className="m-0 max-w-md text-center text-gold">{view.log[view.log.length - 1]}</p>
            ) : null}
            {view.action ? <Countdown clock={props.clock} timeoutMs={view.action.timeoutMs} /> : null}
            {props.error ? <p className="m-0 text-cinnabar">{props.error}</p> : null}
            <div className="flex flex-wrap justify-center gap-2">
              {directPlay && strikePlay && !aimAs ? (
                <>
                  <button
                    className="rounded-md bg-lamp px-4 py-2 font-semibold text-lacquer"
                    type="button"
                    onClick={() => {
                      props.onSend("play", { cardId: directPlay.cardId, targets: [] });
                      setAimId(null);
                    }}
                  >
                    打出这张牌
                  </button>
                  <button
                    className="rounded-md border border-gold px-4 py-2 text-lamp"
                    type="button"
                    onClick={() => setAimAs("strike")}
                  >
                    当杀
                  </button>
                </>
              ) : null}
              {zhiheng ? (
                <button
                  className="rounded-md bg-lamp px-4 py-2 font-semibold text-lacquer disabled:opacity-40"
                  type="button"
                  disabled={zhihengIds.length === 0}
                  onClick={() => props.onSend("invokeSkill", { skillId: "zhiheng", payload: { cardIds: zhihengIds } })}
                >
                  弃 {zhihengIds.length} 张并摸牌
                </button>
              ) : null}
              {myTurn ? (
                <button
                  className="rounded-md bg-lamp px-4 py-2 font-semibold text-lacquer"
                  type="button"
                  onClick={() => props.onSend("endPlay")}
                >
                  结束出牌
                </button>
              ) : null}
              {answering && view.action?.allowPass ? (
                <button
                  className="rounded-md border border-gold px-4 py-2 text-lamp"
                  type="button"
                  onClick={() => props.onSend("resolve", { cardId: null })}
                >
                  放弃
                </button>
              ) : null}
              {discarding ? (
                <button
                  className="rounded-md bg-lamp px-4 py-2 font-semibold text-lacquer disabled:opacity-40"
                  type="button"
                  disabled={discardIds.length !== discardNeed}
                  onClick={() => props.onSend("discard", { cardIds: discardIds })}
                >
                  弃掉这 {discardNeed} 张
                </button>
              ) : null}
            </div>
          </section>

          {flank ? (
            <div className="flank">
              <Seat
                player={others[1]!}
                active={others[1]?.id === view.currentPlayerId}
                acting={reveals.some((reveal) => reveal.actor === others[1]?.name)}
                legal={Boolean(aimed?.targets.includes(others[1]?.id ?? ""))}
                stealing={!aimAs && (aimedCard?.type === "dismantle" || aimedCard?.type === "snatch")}
                pulse={props.pulses.find((item) => item.playerId === others[1]?.id)}
                onPulseDone={props.onPulseDone}
                onChoose={(pick) => others[1] && onSeat(others[1], pick)}
              />
            </div>
          ) : null}
        </div>

        <aside className="war-log px-3 py-3">
          <h2 className="m-0 font-[family-name:var(--font-card)] text-xl text-gold">战报</h2>
          <ol ref={logRef} className="mt-2 mb-0 flex max-h-80 list-none flex-col gap-1 overflow-auto p-0 text-sm text-ash">
            {(view.log ?? []).length === 0 ? <li>牌局还没动静。</li> : null}
            {(view.log ?? []).map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ol>
        </aside>
      </div>

      {me ? (
        <footer className="self-dock mt-3 px-2 pt-3">
          <div className="flex flex-wrap items-start gap-4">
            <Seat
              player={me}
              active={me.id === view.currentPlayerId}
              acting={reveals.some((reveal) => reveal.actor === me.name)}
              legal={false}
              stealing={false}
              self
              zhiheng={zhiheng}
              zhihengIds={zhihengIds}
              armIds={armIds}
              onArm={onArm}
              onSkill={(skillId) => {
                if (skillId !== "zhiheng") return;
                setZhiheng((current) => !current);
                setZhihengIds([]);
                setAimId(null);
                setAimAs(null);
              }}
              pulse={props.pulses.find((item) => item.playerId === me.id)}
              onPulseDone={props.onPulseDone}
            />
          </div>
          <div className="hand-scroll">
            <div className="hand-row flex min-w-max justify-center">
              {(me.hand ?? []).map((card) => {
                const enabled = playable(card);
                const selected = aimId === card.id || discardIds.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    data-card-id={card.id}
                    disabled={!enabled}
                    className={`play-card ${selected || zhihengIds.includes(card.id) ? "is-picked" : ""}`}
                    onClick={() => onCard(card)}
                  >
                    <CardFace card={card} />
                  </button>
                );
              })}
            </div>
          </div>
        </footer>
      ) : null}

      {view.over ? (
        <div className="end-veil" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="end-sheet">
            <h2 id="end-title" className="m-0 font-[family-name:var(--font-card)] text-4xl text-gold">
              游戏结束：{outcome(view.winReason)}
            </h2>
            <button className="end-again" type="button" onClick={props.onRematch}>
              再来一局
            </button>
          </div>
        </div>
      ) : null}

      {props.flights.map((flight) => (
        <FlightCard key={flight.key} flight={flight} onDone={() => props.onFlightDone(flight.key)} />
      ))}
    </main>
  );
}

function outcome(reason: string | undefined): string {
  if (reason === "lord-loyalist") return "主忠方获胜";
  if (reason === "rebel") return "反贼方获胜";
  if (reason === "spy") return "内奸获胜";
  return "对局结束";
}

function lineFor(view: ClientView, aimed: Card | null, aimAs: "strike" | null): string {
  if (view.over) return "对局结束";
  if (aimAs === "strike") return "这张牌当杀，点一名攻击范围内的角色";
  if (aimed?.type === "strike") return "点一名攻击范围内的角色";
  if (aimed?.type === "dismantle") return "点头像弃随机手牌，或点装备、判定牌";
  if (aimed?.type === "snatch") return "点距离内的角色。头像拿随机手牌，或点装备、判定牌";
  if (aimed) return "点一名角色";
  if (view.action?.playerId === view.you) {
    if (view.action.interaction === "DYING") {
      return `${playerName(view, view.action.dyingPlayerId ?? view.you)} 濒死，可以出桃`;
    }
    if (view.action.acceptTypes.includes("strike") && !view.action.acceptTypes.includes("dodge")) {
      return "需要打出一张杀";
    }
    return "需要打出一张闪";
  }
  if (view.pending?.kind === "discard" && view.pending.playerId === view.you) {
    return `手牌过多，弃掉 ${view.pending.count} 张`;
  }
  if (view.currentPlayerId === view.you && view.phase === "play" && view.interaction === "idle") {
    return "轮到你出牌";
  }
  if (view.action) return `等待 ${playerName(view, view.action.playerId)} 响应`;
  return `等待 ${playerName(view, view.currentPlayerId)}`;
}

function Seat({
  player,
  active,
  legal,
  stealing,
  acting = false,
  self = false,
  zhiheng = false,
  zhihengIds = [],
  armIds = [],
  onArm,
  onSkill,
  pulse,
  onPulseDone,
  onChoose,
}: {
  player: PublicPlayer;
  active: boolean;
  legal: boolean;
  stealing: boolean;
  acting?: boolean;
  self?: boolean;
  zhiheng?: boolean;
  zhihengIds?: string[];
  armIds?: string[];
  onArm?: (cardId: string) => void;
  onSkill?: (skillId: string) => void;
  pulse?: HpPulse;
  onPulseDone: (key: string) => void;
  onChoose?: (pick?: string) => void;
}) {
  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => onPulseDone(pulse.key), 700);
    return () => window.clearTimeout(timer);
  }, [pulse, onPulseDone]);

  const full = player.hp >= player.maxHp;
  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="hero-column">
          {onChoose && legal ? (
            <button type="button" className="hero-frame" onClick={() => onChoose()}>
              <HeroPlate player={player} />
            </button>
          ) : (
            <div className="hero-frame">
              <HeroPlate player={player} />
            </div>
          )}
          {(player.skills ?? []).map((skill) =>
            self && skill.active ? (
              <button
                key={skill.id}
                type="button"
                className="skill-button"
                title={skill.description}
                disabled={!skill.usable}
                onClick={() => onSkill?.(skill.id)}
              >
                {skill.name}
              </button>
            ) : (
              <p key={skill.id} className="skill-tag" title={skill.description}>
                {skill.name}
              </p>
            ),
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-ash">{self ? "你" : player.name}</span>
            <span className="text-ash">{player.handCount} 张</span>
            <SeatStatus player={player} active={active} />
          </div>
          <div className="relative mt-2 flex flex-wrap gap-1" aria-label={`体力 ${Math.max(0, player.hp)}`}>
            {Array.from({ length: Math.max(player.maxHp, 1) }, (_, index) => (
              <Magatama key={index} filled={index < player.hp} full={full} />
            ))}
            <span className="hp-count">
              {Math.max(0, player.hp)}/{player.maxHp}
            </span>
            {pulse ? <span className="hp-delta">{pulse.delta > 0 ? `+${pulse.delta}` : pulse.delta}</span> : null}
          </div>
          <Zones
            player={player}
            stealing={stealing && legal}
            zhiheng={zhiheng}
            zhihengIds={zhihengIds}
            armIds={armIds}
            onPick={(id) => onChoose?.(id)}
            onArm={onArm}
          />
        </div>
      </div>
      {self ? null : (
        <div className="mt-2">
          <CardBack />
        </div>
      )}
    </>
  );

  const className = `seat text-left ${self ? "w-full max-w-xl" : ""} ${active ? "is-turn" : ""} ${legal ? "is-legal" : ""} ${acting ? "is-acting" : ""}`;
  return (
    <article data-seat-id={player.id} className={className}>
      {body}
    </article>
  );
}

function HeroPlate({ player }: { player: PublicPlayer }) {
  const mark = ROLE_MARK[player.role];
  return (
    <>
      {player.role === "lord" ? <Crown /> : null}
      <p className="hero-name">{player.heroName ?? player.name}</p>
      {mark ? <span className="role-seal">{mark}</span> : null}
    </>
  );
}

function Crown() {
  return (
    <svg className="crown" viewBox="0 0 24 16" aria-hidden="true">
      <path d="M2 14 L4 6 L8 10 L12 2 L16 10 L20 6 L22 14 Z" fill="#e4c57a" stroke="#8a6a2f" strokeWidth="1" />
    </svg>
  );
}

function Zones({
  player,
  stealing,
  zhiheng = false,
  zhihengIds = [],
  armIds = [],
  onPick,
  onArm,
}: {
  player: PublicPlayer;
  stealing: boolean;
  zhiheng?: boolean;
  zhihengIds?: string[];
  armIds?: string[];
  onPick: (cardId: string) => void;
  onArm?: (cardId: string) => void;
}) {
  const slots: Array<[string, string, Card | undefined]> = [
    ["weapon", "武器", player.equipment.weapon],
    ["armor", "防具", player.equipment.armor],
    ["horseOffensive", "-1马", player.equipment.horseOffensive],
    ["horseDefensive", "+1马", player.equipment.horseDefensive],
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {slots.map(([key, label, card]) =>
        card ? (
          <button
            key={key}
            type="button"
            className={`zone-chip is-live ${zhihengIds.includes(card.id) ? "is-picked" : ""}`}
            disabled={!stealing && !zhiheng && !armIds.includes(card.id)}
            onClick={(event) => {
              event.stopPropagation();
              if (zhiheng || armIds.includes(card.id)) {
                onArm?.(card.id);
                return;
              }
              if (stealing) onPick(card.id);
            }}
          >
            {label} {card.name}
          </button>
        ) : (
          <span key={key} className="zone-chip">
            {label}
          </span>
        ),
      )}
      {player.judgmentZone.length === 0 ? <span className="zone-chip">判定</span> : null}
      {player.judgmentZone.map((card) => (
        <button
          key={card.id}
          type="button"
          className="zone-chip is-live"
          disabled={!stealing}
          onClick={(event) => {
            event.stopPropagation();
            if (stealing) onPick(card.id);
          }}
        >
          判定 {card.name}
        </button>
      ))}
    </div>
  );
}

function Pile({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-center">
      <CardBack />
      <p className="m-0 mt-2 text-sm text-ash">
        {label} {count}
      </p>
    </div>
  );
}

function Countdown({ clock, timeoutMs }: { clock: Clock | null; timeoutMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [clock?.at]);
  const left = Math.max(0, (clock?.remainingMs ?? 0) - (now - (clock?.at ?? now)));
  const ratio = timeoutMs > 0 ? left / timeoutMs : 0;
  const seconds = Math.ceil(left / 1000);
  return (
    <div className="w-full">
      <p className="m-0 mb-1 text-center text-sm text-gold tabular-nums">还剩 {seconds} 秒</p>
      <div className="time-track mx-auto">
        <div className="time-bar" style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </div>
  );
}

function FlightCard({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!node) return;
    const end = centerOf(document.querySelector("[data-table-center]")?.getBoundingClientRect());
    const start = flight.origin ?? end;
    node.style.transform = `translate(${start.x}px, ${start.y}px)`;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        node.style.transform = `translate(${end.x}px, ${end.y}px)`;
      });
    });
    const timer = window.setTimeout(() => doneRef.current(), 520);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [node, flight.key, flight.origin]);

  return (
    <div ref={setNode} className="flight">
      <CardFace card={flight.card} />
    </div>
  );
}

function centerOf(rect: DOMRect | undefined): { x: number; y: number } {
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.left + rect.width / 2 - 48, y: rect.top + rect.height / 2 - 67 };
}

function SeatStatus({ player, active }: { player: PublicPlayer; active: boolean }) {
  const text = !player.alive ? "已阵亡" : !player.connected ? "暂时离开" : active ? "当前回合" : "";
  if (!text) return null;
  return <p className="m-0 text-sm text-ash">{text}</p>;
}
