import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { go } from '../lib/api';

export function Tag({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function CardFace({ card }: { card: string }) {
  const suit = card.slice(-1).toLowerCase(),
    red = suit === 'h' || suit === 'd';
  return (
    <span className={`card-face ${red ? 'red' : ''}`}>
      <b>{card.slice(0, -1)}</b>
      <span>{{ s: '♠', h: '♥', d: '♦', c: '♣' }[suit as 's' | 'h' | 'd' | 'c'] || suit}</span>
    </span>
  );
}

export function SectionHead({
  label,
  title,
  link,
  href,
}: {
  label: string;
  title: string;
  link: string;
  href: string;
}) {
  return (
    <div className="sec-row">
      <div className="sec-head">
        <p className="eyebrow">{label}</p>
        <h2>{title}</h2>
      </div>
      <button className="text-btn" onClick={() => go(href)}>
        {link} <ArrowUpRight size={15} />
      </button>
    </div>
  );
}

export function Empty({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true" />
      <p>{text}</p>
      {action && (
        <button onClick={onClick}>
          {action} <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}

export function PageTitle({
  kicker,
  title,
  subtitle,
  action,
}: {
  kicker: string;
  title: React.ReactNode;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <small>{kicker}</small>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
