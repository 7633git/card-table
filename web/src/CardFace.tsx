import type { Card } from "./protocol.js";
import { rankLabel } from "./protocol.js";

function SuitGlyph({ suit }: { suit: Card["suit"] }) {
  const ink = suit === "heart" || suit === "diamond" ? "var(--suit-red)" : "var(--card-ink)";
  if (suit === "none") return <span className="block h-3 w-3" />;
  const path =
    suit === "heart"
      ? "M8 14s-6-3.6-6-7.2C2 4.4 3.8 3 5.6 3 6.8 3 7.6 3.6 8 4.4 8.4 3.6 9.2 3 10.4 3 12.2 3 14 4.4 14 6.8 14 10.4 8 14 8 14z"
      : suit === "diamond"
        ? "M8 2.2 13.2 8 8 13.8 2.8 8z"
        : suit === "spade"
          ? "M8 1.6c2.8 3 6 5.2 6 8.2 0 2-1.4 3.4-3.2 3.4-1.2 0-2-.6-2.5-1.4.2 1.6.2 2.8 1.5 3.6H6.2c1.3-.8 1.3-2 1.5-3.6C7.2 12.8 6.4 13.2 5.2 13.2 3.4 13.2 2 11.8 2 9.8c0-3 3.2-5.2 6-8.2z"
          : "M8 2.4c1.5 1.5 2.6 2.2 4.2 2.2 1.6 0 2.8 1.3 2.8 3S13.6 11 12 11c-.5 0-1-.1-1.4-.4.5 1.4 1.6 2.2 2.4 2.6v1.2H3v-1.2c.8-.4 1.9-1.2 2.4-2.6C5 10.9 4.5 11 4 11c-1.6 0-3-1.4-3-3.2S2.4 4.6 4 4.6c1.6 0 2.7-.7 4-2.2z";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d={path} fill={ink} />
    </svg>
  );
}

function toneOf(card: Card): string {
  if (card.category === "equip" || card.kind === "EQUIP") return "tone-equip";
  if (card.category === "delayed-trick" || card.kind === "DELAYED_SCROLL") return "tone-delay";
  if (card.category === "trick" || card.kind === "SCROLL") return "tone-trick";
  if (card.type === "strike") return "tone-strike";
  if (card.type === "heal") return "tone-heal";
  return "tone-dodge";
}

function kindLabel(card: Card): string {
  if (card.kind === "SCROLL" || card.category === "trick") return "锦囊";
  if (card.kind === "DELAYED_SCROLL" || card.category === "delayed-trick") return "延时";
  if (card.kind === "EQUIP" || card.category === "equip") return "装备";
  return "基本";
}

export function CardFace({ card }: { card: Card }) {
  const red = card.suit === "heart" || card.suit === "diamond";
  return (
    <article className={`card-sheet ${toneOf(card)}`}>
      <div className="card-index" style={{ color: red ? "var(--suit-red)" : "var(--card-ink)" }}>
        <span className="card-rank">{rankLabel(card.rank)}</span>
        <SuitGlyph suit={card.suit} />
      </div>
      <p className="card-title">{card.name}</p>
      <p className="card-kind">{kindLabel(card)}</p>
    </article>
  );
}

export function CardBack() {
  return <div className="card-back" aria-hidden="true" />;
}

export function Magatama({ filled, full }: { filled: boolean; full: boolean }) {
  const color = !filled ? "transparent" : full ? "var(--leaf)" : "var(--hp-low)";
  const stroke = filled ? color : "rgb(215 203 182 / 0.55)";
  return (
    <svg className="magatama" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 13.6 2.6 8.5C1.2 7.1 1.3 4.8 2.9 3.5 4.2 2.4 6.1 2.5 7.2 3.6L8 4.4l.8-.8c1.1-1.1 3-1.2 4.3-.1 1.6 1.3 1.7 3.6.3 5L8 13.6z"
        fill={color}
        stroke={stroke}
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}
