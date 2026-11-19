import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { handleLinkKlick } from '../routing/linkModifier';
import { useVorigeAdresse } from '../routing/VerlaufMerken';

/**
 * Ortspfad-Glied zurück auf eine Liste oder übergeordnete Seite (LLH-1997, `frontend/AGENTS.md`,
 * Deeplink-Muster, „Ortspfad zur Liste über `ListenRueckweg`“).
 *
 * Kam man per PUSH von genau dieser Seite (Pfad gleich, die Query zählt nicht: Einsatzkraft und
 * Befehl zielen auf ihre Liste mit Zeilenmarke), geht der einfache Klick per `navigate(-1)`
 * zurück: Ansicht und Filter stehen dann aus der Adresse wieder da, die Rollposition stellt die
 * Rückkehr im Verlauf her. Das `href` trägt die vorige Adresse samt Query, damit Strg- und
 * Mittelklick die gefilterte Liste in einem neuen Tab öffnen. Sonst (direkt geöffnet, von einer
 * anderen Seite) ein gewöhnlicher Link auf `to`.
 */
export function ListenRueckweg({ to, children }: { to: string; children: ReactNode }) {
  const vorige = useVorigeAdresse();
  const navigate = useNavigate();
  const passt = vorige !== null && pfadVon(to) === vorige.pathname;
  if (!passt) return <Link to={to}>{children}</Link>;
  return (
    <Link
      to={vorige.pathname + vorige.search}
      onClick={(e) => handleLinkKlick(e, () => void navigate(-1))}
    >
      {children}
    </Link>
  );
}

function pfadVon(to: string): string {
  return new URL(to, 'http://lfh.invalid').pathname;
}
