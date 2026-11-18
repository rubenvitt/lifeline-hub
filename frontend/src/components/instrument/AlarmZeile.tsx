import { Popover } from 'antd';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { schrift } from '../../theme/tokens';
import { GROSS_BEZUG, grossMass } from '../grossbild/grossMass';
import type { AlarmEintrag, WasBrennt } from '../../lage/wasBrennt';
import { useRollen } from './rollenwerte';
import { statusFlaeche } from './statusFlaeche';

/**
 * AlarmZeile „Was brennt“ (LLH-1743, Spec `lage-alarmzeile`, design.md D3; Regel
 * „Dashboard-Baukasten“, `frontend/AGENTS.md`): das erste Element unter dem Seitenkopf von
 * Überblick, Lagebild und Lagemonitor. Der Baustein ordnet nur an; Einträge, Folge und Wortlaut
 * kommen aus `lage/wasBrennt.ts`.
 *
 * - **Feste Höhe** in jeder Lage (Spec „Feste Höhe ohne Sprung“): eine Zeile, was nicht passt,
 *   steht als „+n“; der Knopf zeigt alle Einträge als Liste. Kein Ton, kein Blinken, kein
 *   Verschieben des Inhalts darunter (Alarmbudget, „Live-Updates springen nicht“).
 * - **Ruhe nur bei vollständigen Quellen:** „Nichts brennt“ nur bei `stand: 'vollstaendig'`;
 *   beim Laden „—“, mit gescheiterter Quelle „Stand unvollständig“ samt Grund.
 * - **Rolle und Wort:** Alarm- und Achtungsfläche aus {@link statusFlaeche}; das Wort im Eintrag ist
 *   der zweite Kanal zur Farbe. `role="status"` (höflich), denn `alert` gehört der Alarmzone.
 * - **`gross`** für den Lagemonitor: 28 px, ohne Bedienung und ohne Links.
 * - **`grossbild`** für das Großbild des Lagebilds (LLH-1931, Spec `grossbild-ansicht`, design.md
 *   D2 der Change `t14j0wpt-alarmzeile-grossbild`): wie `gross`, aber jedes Maß über `grossMass`,
 *   also 28 px bei 1920 × 1080 und mit dem Fenster wachsend.
 */

export type AlarmGroesse = 'normal' | 'gross' | 'grossbild';

/**
 * Schriftgröße der Zeile: mindestens 16 px (Spec), am Monitor die Großbild-Stufe 28 px, im Großbild
 * des Lagebilds 28 Bezugspixel über `grossMass`.
 */
export const ALARMZEILE_SCHRIFT = {
  normal: 16,
  gross: 28,
  grossbild: grossMass(GROSS_BEZUG.text),
} as const;
/**
 * Höhe eines Eintrags: am Monitor fest, sonst die Steuerhöhe der Dichtestufe (30 / 48 / 72 px,
 * Spec `einsatztauglichkeit-layout`, „Trefffläche folgt der Dichtestufe“), nie unter 28 px. Die
 * Zeile ist um den Abstand oben und unten höher; in einer Stufe bleibt sie fest.
 */
export function alarmEintragHoehe(groesse: 'normal' | 'gross', steuerHoehe: number): number {
  return groesse === 'gross' ? 40 : Math.max(28, steuerHoehe);
}

/** Eine Länge: Zahl in px (React hängt `px` an) oder eine CSS-Länge wie `grossMass(…)`. */
type Laenge = number | string;

const css = (l: Laenge) => (typeof l === 'number' ? `${l}px` : l);

/**
 * Maße einer Größe an einer Stelle. Bei `grossbild` sind es Bezugspixel bei 1920 × 1080 über
 * `grossMass`: Eintrag 56 wie die Knöpfe im Kopf der Fläche, Abstand 8, Zeile 56 + 2 · 8.
 */
interface AlarmMass {
  eintrag: Laenge;
  abstand: Laenge;
  hoehe: Laenge;
  luecke: Laenge;
  innen: Laenge;
  kante: Laenge;
}

function alarmMass(groesse: AlarmGroesse, steuerHoehe: number): AlarmMass {
  if (groesse === 'grossbild') {
    return {
      eintrag: grossMass(56),
      abstand: grossMass(GROSS_BEZUG.eng),
      hoehe: grossMass(56 + 2 * GROSS_BEZUG.eng),
      luecke: grossMass(2 * GROSS_BEZUG.eng),
      innen: grossMass(16),
      kante: grossMass(6),
    };
  }
  const eintrag = alarmEintragHoehe(groesse, steuerHoehe);
  const abstand = 6;
  const gross = groesse === 'gross';
  return {
    eintrag,
    abstand,
    hoehe: eintrag + 2 * abstand,
    luecke: abstand * 2,
    innen: gross ? 16 : 10,
    kante: gross ? 6 : 3,
  };
}

interface AlarmZeileProps {
  daten: Pick<WasBrennt, 'eintraege' | 'stand' | 'fehlend'>;
  /** Sprungziel je Eintrag; `undefined` = ohne Link. Am Monitor weggelassen. */
  ziel?: (e: AlarmEintrag) => string | undefined;
  groesse?: AlarmGroesse;
}

/**
 * Wie viele Einträge passen neben „+n“ und den Hinweis in die Breite? Gemessen, nie gerechnet.
 * `reserviert` ist der Platz des Hinweises („Stand unvollständig …“): er muss lesbar bleiben
 * (Spec „Ruhe nur bei vollständigen Quellen“), also weichen Einträge ihm, nicht umgekehrt.
 */
export function passend(
  breite: number,
  eintragsBreiten: number[],
  plusBreite: number,
  abstand: number,
  reserviert = 0,
) {
  const alle = eintragsBreiten.reduce((n, b) => n + b + abstand, 0);
  if (breite <= 0 || alle + reserviert <= breite) return eintragsBreiten.length;
  let belegt = plusBreite + reserviert;
  let anzahl = 0;
  for (const b of eintragsBreiten) {
    if (belegt + b + abstand > breite) break;
    belegt += b + abstand;
    anzahl += 1;
  }
  return anzahl;
}

export default function AlarmZeile({ daten, ziel, groesse = 'normal' }: AlarmZeileProps) {
  const { rollen, token } = useRollen();
  // Ohne Bedienung: Lagemonitor und Großbild zeigen nur.
  const gross = groesse !== 'normal';
  const fontSize = ALARMZEILE_SCHRIFT[groesse];
  const mass = alarmMass(groesse, token.controlHeight);
  const eintragHoehe = mass.eintrag;
  const abstand = mass.abstand;
  const { eintraege, stand, fehlend } = daten;

  const reiheRef = useRef<HTMLDivElement>(null);
  const messRef = useRef<HTMLDivElement>(null);
  const [sichtbar, setSichtbar] = useState(eintraege.length);
  const schluessel = eintraege.map((e) => e.text).join('|');
  const fehlendSchluessel = fehlend.join('|');

  useLayoutEffect(() => {
    const reihe = reiheRef.current;
    const mess = messRef.current;
    if (!reihe || !mess) return;
    const messen = () => {
      const breiten = (art: string) =>
        Array.from(mess.querySelectorAll<HTMLElement>(`:scope > [data-mess="${art}"]`)).map(
          (k) => k.offsetWidth,
        );
      const hinweisBreite = breiten('hinweis')[0];
      // Eine CSS-Länge (Großbild) wird gemessen, nie gerechnet: sie hängt am Fenster.
      const luft = typeof abstand === 'number' ? abstand : (breiten('abstand')[0] ?? 0);
      setSichtbar(
        passend(
          reihe.clientWidth,
          breiten('eintrag'),
          (breiten('plus')[0] ?? 0) + luft,
          luft,
          hinweisBreite != null ? hinweisBreite + luft : 0,
        ),
      );
    };
    messen();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(messen);
    ro.observe(reihe);
    return () => ro.disconnect();
  }, [schluessel, abstand, stand, fehlendSchluessel]);

  const eintragStil = (e: AlarmEintrag): CSSProperties => {
    const f = statusFlaeche(rollen, e.rolle);
    return {
      display: 'inline-flex',
      alignItems: 'center',
      flex: '0 0 auto',
      height: eintragHoehe,
      padding: `0 ${css(mass.innen)}`,
      background: f.grund,
      color: f.text,
      borderLeft: `${css(mass.kante)} solid ${f.kante}`,
      // Auch in der Liste hinter „+n“ (Portal am body, erbt nichts): mindestens 16 px.
      fontSize,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      textDecoration: 'none',
    };
  };

  const eintrag = (e: AlarmEintrag, mitLink: boolean, gemessen = false) => {
    const pfad = mitLink ? ziel?.(e) : undefined;
    if (gemessen) {
      return (
        <span key={e.art} data-mess="eintrag" style={eintragStil(e)}>
          {e.text}
        </span>
      );
    }
    const inhalt = (
      <span data-lfh="alarm-eintrag" data-art={e.art} data-ton={e.rolle} title={e.voll}>
        {e.text}
      </span>
    );
    return pfad ? (
      <Link key={e.art} to={pfad} style={eintragStil(e)} aria-label={e.voll}>
        {inhalt}
      </Link>
    ) : (
      <span key={e.art} style={eintragStil(e)}>
        {inhalt}
      </span>
    );
  };

  const rest = eintraege.length - sichtbar;
  const hinweis =
    stand === 'unvollstaendig'
      ? `Stand unvollständig: ${fehlend.join(', ')} nicht geladen`
      : stand === 'laedt' && eintraege.length === 0
        ? '—'
        : stand === 'vollstaendig' && eintraege.length === 0
          ? 'Nichts brennt'
          : null;

  const hinweisStil: CSSProperties = {
    color: rollen.text2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  };
  const plusStil: CSSProperties = {
    flex: '0 0 auto',
    height: eintragHoehe,
    padding: `0 ${css(mass.innen)}`,
    border: `1px solid ${rollen.steuerRahmen}`,
    background: 'transparent',
    color: rollen.text,
    font: 'inherit',
    fontWeight: 600,
    cursor: gross ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
  };
  const plus =
    rest > 0 ? (
      gross ? (
        <span
          data-lfh="alarm-mehr"
          style={{ ...plusStil, display: 'inline-flex', alignItems: 'center' }}
        >
          +{rest}
        </span>
      ) : (
        <Popover
          trigger="click"
          placement="bottomLeft"
          content={
            <ul
              data-lfh="alarm-liste"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: token.marginXS,
              }}
            >
              {eintraege.map((e) => (
                <li key={e.art}>{eintrag({ ...e, text: e.voll }, true)}</li>
              ))}
              {stand === 'unvollstaendig' && hinweis && (
                <li style={{ ...hinweisStil, fontSize }}>{hinweis}</li>
              )}
            </ul>
          }
        >
          <button
            type="button"
            data-lfh="alarm-mehr"
            style={plusStil}
            aria-label={`Alle ${eintraege.length} zeigen`}
          >
            +{rest}
          </button>
        </Popover>
      )
    ) : null;

  return (
    <section
      data-lfh="alarm-zeile"
      data-stand={stand}
      role="status"
      aria-live="polite"
      aria-label="Was brennt"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: mass.luecke,
        height: mass.hoehe,
        padding: `0 ${css(abstand)}`,
        background: rollen.paneel,
        borderBottom: `1px solid ${rollen.linie}`,
        fontFamily: schrift.text,
        fontSize,
        lineHeight: 1.2,
        overflow: 'hidden',
      }}
    >
      <div
        ref={reiheRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: abstand,
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {eintraege.slice(0, sichtbar).map((e) => eintrag(e, !gross))}
        {plus}
        {hinweis && (
          <span data-lfh="alarm-hinweis" title={hinweis} style={hinweisStil}>
            {hinweis}
          </span>
        )}
      </div>
      {/* Messreihe: alle Einträge, „+n“ und der Hinweis eines unvollständigen Stands unsichtbar,
        außerhalb des Flusses (keine Höhe). */}
      <div
        ref={messRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          display: 'flex',
          gap: abstand,
          left: 0,
          top: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {eintraege.map((e) => eintrag(e, false, true))}
        <span data-mess="plus" style={plusStil}>
          +{eintraege.length}
        </span>
        {stand === 'unvollstaendig' && hinweis && (
          <span data-mess="hinweis" style={{ ...hinweisStil, overflow: 'visible' }}>
            {hinweis}
          </span>
        )}
        {typeof abstand !== 'number' && (
          <span data-mess="abstand" style={{ flex: '0 0 auto', width: abstand }} />
        )}
      </div>
    </section>
  );
}
