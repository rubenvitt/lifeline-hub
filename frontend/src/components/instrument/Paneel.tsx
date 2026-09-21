import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import Augenbraue from './Augenbraue';
import { monoStil, useRollen } from './rollenwerte';

/**
 * Paneel — die Grundfläche des Neuentwurfs für Seitenleisten, Kachel-Paneele und
 * Listenblöcke (S2 „Einsatzabschnitte", „Offene Anordnungen"; S4 „Tagesbilanz").
 *
 * Rahmen `linie`, Grund `paneel`, Kopf 38 px mit Augenbraue links und optionalem
 * Mono-Meta bzw. einer Aktion rechts, Haarlinie darunter, Radius 0. Der Körper trägt
 * keine eigene Polsterung — Zeilen bringen sie mit (Trenner `flaeche3`, siehe
 * {@link paneelZeileStil}); wer Fließinhalt hineinlegt, setzt `koerperPolster`.
 *
 * Die Überschrift ist SEMANTISCH (`ueberschrift="h2"`/`"h3"`), die Augenbraue nur ihre
 * Optik; das `<section>` wird über sie benannt (`aria-labelledby`). Ein Paneel ohne
 * Überschrift gibt es nicht — ein unbenannter Block ist genau die Fläche, die der
 * Entwurf durch die Augenbraue abschafft.
 *
 * Die 38 px sind eine MINDESThöhe, keine feste: steht rechts eine Aktion, wächst der Kopf
 * mit deren Dichte-Staffel (30 / 48 / 72) mit, statt sie abzuschneiden.
 */
export const PANEEL_KOPF_HOEHE = 38;

export function paneelStil(rollen: Pick<Farbrollen, 'linie' | 'paneel' | 'text'>): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    background: rollen.paneel,
    border: `1px solid ${rollen.linie}`,
    borderRadius: 0,
    color: rollen.text,
  };
}

export function paneelKopfStil(
  rollen: Pick<Farbrollen, 'linie'>,
  token: { padding: number; paddingXS: number },
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: token.padding,
    minHeight: PANEEL_KOPF_HOEHE,
    paddingBlock: token.paddingXS,
    paddingInline: token.padding,
    borderBlockEnd: `1px solid ${rollen.linie}`,
    flex: '0 0 auto',
  };
}

/** Eine Zeile im Paneel: Trenner `flaeche3` (Entwurf `#16191d`), Polster aus der Staffel. */
export function paneelZeileStil(
  rollen: Pick<Farbrollen, 'flaeche3'>,
  token: { padding: number; paddingSM: number },
): CSSProperties {
  return {
    paddingBlock: token.paddingSM,
    paddingInline: token.padding,
    borderBlockEnd: `1px solid ${rollen.flaeche3}`,
  };
}

interface PaneelProps {
  /** Wortlaut der Augenbraue — Pflicht, siehe Dateikopf. */
  titel: ReactNode;
  /** Überschriftenebene; Vorgabe `h2`. */
  ueberschrift?: 'h2' | 'h3' | 'h4';
  /** Mono-Meta rechts im Kopf („4 Abschnitte · 31 Einheiten"). */
  meta?: ReactNode;
  /** Aktion rechts im Kopf (Link/Knopf) — steht nach dem Meta. */
  aktion?: ReactNode;
  /** Fußzeile unter dem Körper, mit Haarlinie abgesetzt. */
  fuss?: ReactNode;
  /** Polsterung des Körpers für Fließinhalt; Vorgabe keine (Zeilen polstern selbst). */
  koerperPolster?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export default function Paneel({
  titel,
  ueberschrift = 'h2',
  meta,
  aktion,
  fuss,
  koerperPolster = false,
  children,
  style,
  className,
}: PaneelProps) {
  const { token, rollen } = useRollen();
  const kopfId = useId();
  return (
    <section
      aria-labelledby={kopfId}
      data-lfh="paneel"
      className={className}
      style={{ ...paneelStil(rollen), ...style }}
    >
      <div style={paneelKopfStil(rollen, token)}>
        <Augenbraue als={ueberschrift} id={kopfId}>
          {titel}
        </Augenbraue>
        {(meta != null || aktion != null) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: token.paddingSM }}>
            {meta != null && <span style={{ ...monoStil(11), color: rollen.schwach }}>{meta}</span>}
            {aktion}
          </div>
        )}
      </div>
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          ...(koerperPolster ? { padding: token.padding } : {}),
        }}
      >
        {children}
      </div>
      {fuss != null && (
        <div
          style={{
            padding: `${token.paddingSM}px ${token.padding}px`,
            borderBlockStart: `1px solid ${rollen.linie}`,
          }}
        >
          {fuss}
        </div>
      )}
    </section>
  );
}

/** Zeile für Paneel-Körper — nur Optik, keine Interaktion. */
export function PaneelZeile({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { token, rollen } = useRollen();
  return <div style={{ ...paneelZeileStil(rollen, token), ...style }}>{children}</div>;
}
