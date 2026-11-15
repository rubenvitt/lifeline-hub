import type { CSSProperties } from 'react';
import type { Einsatzart } from '../../api/types';
import { istUebung } from '../../einsatz/einsatzart';
import type { Farbrollen } from '../../theme/tokens';
import { RAHMEN_EBENE, useRahmenObenStapel } from '../rahmenOben';
import { schriftStil, useRollen } from './rollenwerte';

/**
 * Übungsmarke (LLH-1725, Spec `uebungsmarke`; `frontend/AGENTS.md`, Rahmen, „Übung“): der EINE
 * Baustein, an dem man eine Übung erkennt, ohne den Namen zu lesen. Zwei Formen:
 *
 * - {@link UebungsMarke}: kompakter Chip vor einem Einsatznamen (Kopf, Liste, Wechsler,
 *   Lagemonitor).
 * - {@link UebungsBand}: Band über die volle Breite unter dem Kopf (Einsatzrahmen, Gerätehülle),
 *   schräg schraffiert, klebt in jeder Breite.
 *
 * Beide entscheiden selbst über {@link istUebung} und rendern sonst nichts, auch keinen
 * Platzhalter: Aufrufer reichen den Einsatz durch und prüfen nicht. Das Wort steht immer dabei
 * (WCAG 1.4.1); die Farbe allein zeigt nichts an. Violett ist nur Übung (`uebungKontrast.test.ts`).
 * Still: kein Ton, kein Blinken (`geraet/AGENTS.md`).
 */

type MitArt = { einsatzart?: Einsatzart | null } | null | undefined;

/** Das Wort; Versalien per CSS, im DOM „Übung“, damit Vorleser es nicht buchstabieren. */
const WORT = 'Übung';

/** Größen der Marke: Kopf, Liste und Wechsler `klein`; der Lagemonitor liest aus Metern. */
const MARKE_SCHRIFT = { klein: 11, monitor: 28 } as const;

function wortStil(rollen: Pick<Farbrollen, 'uebungText'>, groesse: number): CSSProperties {
  return {
    ...schriftStil('augenbraue'),
    fontSize: groesse,
    fontWeight: 700,
    lineHeight: 1.2,
    color: rollen.uebungText,
    whiteSpace: 'nowrap',
  };
}

export function UebungsMarke({
  einsatz,
  groesse = 'klein',
  style,
}: {
  einsatz: MitArt;
  groesse?: keyof typeof MARKE_SCHRIFT;
  style?: CSSProperties;
}) {
  const { rollen } = useRollen();
  if (!istUebung(einsatz)) return null;
  const px = MARKE_SCHRIFT[groesse];
  return (
    <span
      data-lfh="uebung-marke"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        paddingBlock: Math.round(px * 0.2),
        paddingInline: Math.round(px * 0.5),
        background: rollen.uebungFuellung,
        // Kante gegen dunkle Flächen; gegen helle trägt die Füllung den Umriss (D2).
        boxShadow: `inset 0 0 0 1px ${rollen.uebungKante}`,
        ...style,
      }}
    >
      <span style={wortStil(rollen, px)}>{WORT}</span>
    </span>
  );
}

/** Schriftgröße des Worts im Band: eine Stufe über dem Lauftext, damit es aus dem Augenwinkel trägt. */
const BAND_SCHRIFT = 13;

/**
 * `klebend` (Vorgabe): das Band klebt im Dokument-Scroll unter den übrigen Rahmenquellen und meldet
 * seine Höhe (Einsatzrahmen, D4). `false` in einer Hülle fester Höhe, die nur innen rollt
 * (Gerätehülle, D7): dort steht es im Fluss, und eine gemeldete Höhe versetzte stehende
 * Tabellenköpfe im inneren Scrollbereich.
 */
export function UebungsBand({ einsatz, klebend = true }: { einsatz: MitArt; klebend?: boolean }) {
  const aktiv = istUebung(einsatz);
  const { rollen } = useRollen();
  // Die Quelle meldet sich nur bei einer klebenden Übung; sonst bleibt die Summe, wie sie war.
  const { ref, oben } = useRahmenObenStapel<HTMLDivElement>(aktiv && klebend);
  if (!aktiv) return null;
  return (
    <div
      ref={ref}
      data-lfh="uebung-band"
      // Kein `role`: das Band ist Kennzeichnung, keine Meldung; Vorleser lesen das Wort im Fluss.
      style={{
        ...(klebend ? { position: 'sticky' as const, top: oben, zIndex: RAHMEN_EBENE } : {}),
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75em',
        paddingBlock: 3,
        paddingInline: 'var(--lfh-seiten-polsterung)',
        background: `repeating-linear-gradient(135deg, ${rollen.uebungFuellung} 0 12px, ${rollen.uebungSchraffur} 12px 24px)`,
        borderBlock: `1px solid ${rollen.uebungKante}`,
      }}
    >
      <span style={wortStil(rollen, BAND_SCHRIFT)}>{WORT}</span>
    </div>
  );
}
