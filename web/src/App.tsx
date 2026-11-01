import { Client, type Room } from "@colyseus/sdk";
import { useEffect, useRef, useState } from "react";
import { diffTable, type Flight, type HpPulse } from "./diff.js";
import type { ClientView, LobbyView, ServerErrorMessage } from "./protocol.js";
import { defaultServerUrl } from "./serverUrl.js";
import { Table } from "./Table.js";
const TOKEN_KEY = "card-reconnect";
const SERVER_KEY = "card-server";
let reconnectStarted = false;

interface Clock {
  remainingMs: number;
  at: number;
}

export function App() {
  const roomRef = useRef<Room | null>(null);
  const viewRef = useRef<ClientView | null>(null);
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [name, setName] = useState("");
  const [seats, setSeats] = useState(2);
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [view, setView] = useState<ClientView | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pulses, setPulses] = useState<HpPulse[]>([]);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  function bind(room: Room) {
    roomRef.current = room;
    room.onMessage<LobbyView>("lobby", (payload) => {
      setLobby(payload);
      if (!payload.started) {
        viewRef.current = null;
        setView(null);
        setFlights([]);
        setPulses([]);
        setClock(null);
      }
    });
    room.onMessage<ClientView>("state", (next) => {
      const prev = viewRef.current;
      viewRef.current = next;
      if (prev && !reduceMotion.current) {
        const delta = diffTable(prev, next);
        const flights = delta.flights.map((flight) => ({ ...flight, origin: measureOrigin(flight) }));
        if (flights.length > 0) setFlights((current) => [...current, ...flights]);
        if (delta.pulses.length > 0) setPulses((current) => [...current, ...delta.pulses]);
      }
      setView(next);
      setClock(next.action ? { remainingMs: next.action.remainingMs, at: Date.now() } : null);
      setError("");
    });
    room.onMessage<ServerErrorMessage>("error", (payload) => setError(payload.message));
    room.onLeave(() => {
      if (roomRef.current === room) roomRef.current = null;
    });
    if (room.reconnectionToken) {
      sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
      sessionStorage.setItem(SERVER_KEY, serverUrl.trim() || defaultServerUrl());
    }
    room.send("sync");
  }

  useEffect(() => {
    if (reconnectStarted) return;
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return;
    reconnectStarted = true;
    const client = new Client(sessionStorage.getItem(SERVER_KEY) || defaultServerUrl());
    client.reconnect(token).then(bind).catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      reconnectStarted = false;
    });
  }, []);

  async function enter(mode: "create" | "join" | "solo") {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("先写一个名字");
      return;
    }
    if (mode === "join" && roomId.trim().length === 0) {
      setError("填写要进入的房间号");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const client = new Client(serverUrl.trim() || defaultServerUrl());
      const room =
        mode === "join"
          ? await client.joinById(roomId.trim(), { name: trimmed })
          : await client.create(
              "card",
              mode === "solo" ? { identity: true, seats: 4, name: trimmed } : { seats, name: trimmed },
            );
      bind(room);
      setLobby(
        (current) =>
          current ?? {
            roomId: room.roomId,
            seats: mode === "solo" ? 4 : seats,
            started: false,
            solo: mode === "solo",
            identity: mode === "solo",
            picking: mode === "solo",
            players: [],
          },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "进不了这间房");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    sessionStorage.removeItem(TOKEN_KEY);
    const room = roomRef.current;
    roomRef.current = null;
    viewRef.current = null;
    setView(null);
    setLobby(null);
    setFlights([]);
    setPulses([]);
    setClock(null);
    await room?.leave();
  }

  function send(type: string, payload?: unknown) {
    roomRef.current?.send(type, payload);
  }

function measureOrigin(flight: Flight): { x: number; y: number } | undefined {
  const selector =
    flight.from === "hand"
      ? `[data-card-id="${CSS.escape(flight.card.id)}"]`
      : `[data-seat-id="${CSS.escape(flight.seatId ?? "")}"]`;
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  if (!rect) return undefined;
  return { x: rect.left + rect.width / 2 - 48, y: rect.top + rect.height / 2 - 67 };
}

  if (!lobby && !view) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-6 py-10">
        <h1 className="m-0 text-5xl font-semibold text-lamp">入座</h1>
        <p className="mt-3 max-w-[40ch] text-ash">
          {serverUrl.replace(/\/$/, "") === window.location.origin
            ? "把这个网址发给朋友，两个人打开同一个地址就能对打。自己玩就选武将开局。"
            : "这是开发页面。朋友联机请打开下面的牌局地址，不要把 5173 这个页面发给他们。"}
        </p>
        <form
          className="mt-8 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void enter(roomId.trim() ? "join" : "create");
          }}
        >
          <label className="grid gap-1">
            <span className="text-ash">名字</span>
            <input
              className="rounded-md border border-lamp-dim bg-plate px-3 py-2 text-ink"
              value={name}
              maxLength={16}
              autoComplete="nickname"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-ash">牌局地址</span>
            <input
              className="rounded-md border border-lamp-dim bg-plate px-3 py-2 text-ink"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </label>
          {roomId.trim() ? null : (
            <label className="grid gap-1">
              <span className="text-ash">人数</span>
              <input
                className="w-24 rounded-md border border-lamp-dim bg-plate px-3 py-2 text-ink"
                type="number"
                min={2}
                max={8}
                value={seats}
                onChange={(event) => setSeats(Number(event.target.value))}
              />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-ash">房间号</span>
            <input
              className="rounded-md border border-lamp-dim bg-plate px-3 py-2 text-ink"
              value={roomId}
              placeholder="留空则新开一桌"
              onChange={(event) => setRoomId(event.target.value)}
            />
          </label>
          {error ? <p className="m-0 text-cinnabar">{error}</p> : null}
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              className="rounded-md bg-lamp px-4 py-2 font-semibold text-lacquer disabled:opacity-40"
              type="button"
              disabled={busy}
              onClick={() => void enter("solo")}
            >
              {busy ? "正在入座" : "开始游戏"}
            </button>
            <button
              className="rounded-md border border-lamp px-4 py-2 font-semibold text-lamp disabled:opacity-40"
              type="submit"
              disabled={busy}
            >
              {busy ? "正在入座" : roomId.trim() ? "进入这间房" : "开一桌"}
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <Table
      lobby={lobby}
      view={view}
      clock={clock}
      error={error}
      flights={flights}
      pulses={pulses}
      onSend={send}
      onLeave={() => void leave()}
      onRematch={() => send("rematch")}
      onFlightDone={(key) => setFlights((current) => current.filter((flight) => flight.key !== key))}
      onPulseDone={(key) => setPulses((current) => current.filter((pulse) => pulse.key !== key))}
    />
  );
}
