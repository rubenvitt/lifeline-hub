import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { TbCompass, TbCrosshair, TbMinus, TbPencil, TbPlus, TbRulerMeasure } from 'react-icons/tb';
import { naechsterIndex, monoStil, segmentStil, useRollen } from '../../components/instrument';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { useZeigerLage, type ZeigerQuelle } from './mausPosition';
import type { GrundlageOption, GrundlageWert } from './leistenDaten';
import '../../theme/sprache.css';
import './lagekarte.css';

/**
 * Überlagerungen der Kartenfläche (Neuentwurf S5): oben links Kartengrundlage und
 * Zeigerkoordinate, oben rechts der Knopfblock (Zoom, Nordung, Zeichnen).
 *
 * KEIN AUFSPANNENDER RAHMEN: jeder Block ist einzeln positioniert. Ein Elternteil über die
 * ganze Karte schluckte jedes Ziehen darunter — derselbe Befund, den `KartenFuss` mit
 * `pointerEvents: 'none'` am Rahmen löst (LFH-355). Die Bänder am UNTEREN Rand stehen
 * weiterhin dort, im Fluss; hier liegt nur, was oben schwebt.
 */

/** Abstand der Überlagerungen zum Kartenrand — derselbe wie der des Kartenfusses. */
export const UEBERLAGERUNG_RAND = 12;

/**
 * Kantenlänge eines Kartenknopfs: der Entwurf zeichnet 32 px, die Dichte-Staffel verlangt
 * mindestens `controlHeight` (30 / 48 / 72). Es gilt das Größere — rein und exportiert, damit
 * die Zusicherung über drei Stufen ohne Rendern prüfbar ist.
 */
export function kartenKnopfKante(token: { controlHeight: number }): number {
  return Math.max(32, token.controlHeight);
}

/**
 * Nächster WÄHLBARER Index nach einer Pfeil-/Pos1-/Ende-Taste: gesperrte Segmente werden
 * übersprungen. `null`, wenn die Taste nicht wandert oder nichts wählbar ist.
 */
export function naechsterFreierIndex(
  taste: string,
  aktuell: number,
  gesperrt: readonly boolean[],
): number | null {
  const n = gesperrt.length;
  if (n === 0 || gesperrt.every(Boolean)) return null;
  // Pos1/Ende: vom Rand aus in Gegenrichtung zum ersten freien.
  if (taste === 'Home' || taste === 'End') {
    const reihe = [...Array(n).keys()];
    const folge = taste === 'Home' ? reihe : reihe.reverse();
    return folge.find((i) => !gesperrt[i]) ?? null;
  }
  let i = naechsterIndex(taste, aktuell, n);
  for (let schritt = 0; i != null && schritt < n; schritt++) {
    if (!gesperrt[i]) return i;
    i = naechsterIndex(taste, i, n);
  }
  return null;
}

/**
 * Segmentleiste der Kartengrundlage — lokale Ergänzung zu `components/instrument/Segmentleiste`,
 * die keinen GESPERRTEN Zustand kennt. Nicht konfigurierte Grundlagen stehen gesperrt da
 * (mit Grund als `title`), statt zu fehlen: dass es keine Offline-Karte gibt, ist eine
 * Aussage über die Installation. Dieselben Klassen (`.lfh-segmente`, `.lfh-segment`) und
 * dieselbe Geometrie (`segmentStil`), Tastatur nach APG mit übersprungenen Sperren.
 */
export function GrundlageLeiste({
  optionen,
  wert,
  onWechsel,
  einzeilig = false,
}: {
  optionen: readonly GrundlageOption[];
  wert: GrundlageWert;
  onWechsel: (wert: GrundlageWert) => void;
  /**
   * Eine Zeile, die waagerecht scrollt, statt umzubrechen — für die Überlagerung der Karte.
   * Mit mehreren Online-Stilen brach die Leiste sonst am Führungs-Tablet (1024 px, Karte
   * ~450 px breit) in drei Zeilen um und deckte das obere Drittel der Karte ab. Der
   * Tastaturweg bleibt: der Fokus holt das gewählte Segment in den sichtbaren Bereich.
   */
  einzeilig?: boolean;
}) {
  const { token } = useRollen();
  const knoepfe = useRef<(HTMLButtonElement | null)[]>([]);
  const aktivIndex = optionen.findIndex((o) => o.wert === wert);
  const gesperrt = optionen.map((o) => o.gesperrt != null);
  // Roving tabindex: das gewählte Segment, ohne Wahl das erste freie.
  const tabZiel = aktivIndex >= 0 ? aktivIndex : gesperrt.findIndex((g) => !g);

  const taste = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const ziel = naechsterFreierIndex(e.key, index, gesperrt);
    if (ziel == null) return;
    e.preventDefault();
    onWechsel(optionen[ziel].wert);
    knoepfe.current[ziel]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Kartengrundlage"
      className="lfh-segmente"
      data-lfh="grundlage-leiste"
      style={
        einzeilig
          ? { flexWrap: 'nowrap', maxWidth: '100%', overflowX: 'auto', scrollbarWidth: 'thin' }
          : undefined
      }
    >
      {optionen.map((o, i) => {
        const aktiv = i === aktivIndex;
        const aus = o.gesperrt != null;
        return (
          <button
            key={o.wert}
            ref={(el) => {
              knoepfe.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={aktiv}
            disabled={aus}
            title={o.gesperrt}
            tabIndex={i === tabZiel ? 0 : -1}
            className={aktiv ? 'lfh-segment lfh-segment--aktiv' : 'lfh-segment'}
            onClick={() => onWechsel(o.wert)}
            onKeyDown={(e) => taste(e, i)}
            style={{
              ...segmentStil(token),
              flexShrink: 0,
              whiteSpace: 'nowrap',
              ...(aus ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Zeigerkoordinate im Format der Einsatz-Einstellungen (Mono 11, Fadenkreuz in `bedien`). */
export function ZeigerKoordinate({ quelle }: { quelle: ZeigerQuelle }) {
  const { token, rollen } = useRollen();
  const { formatKoordinate } = useAnzeigeKonventionen();
  const lage = useZeigerLage(quelle);
  return (
    <div
      data-lfh="zeiger-koordinate"
      title="Position des Zeigers"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXS,
        alignSelf: 'flex-start',
        minHeight: 28,
        padding: `0 ${token.paddingSM}px`,
        background: rollen.kopf,
        border: `1px solid ${rollen.linieStark}`,
        color: rollen.gedaempft,
        ...monoStil(11),
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.bedien }}>
        <TbCrosshair size={14} />
      </span>
      {lage ? formatKoordinate(lage.lat, lage.lon) : '—'}
    </div>
  );
}

function Kartenknopf({
  beschriftung,
  onClick,
  kante,
  farbe,
  gedrueckt,
  children,
}: {
  beschriftung: string;
  onClick: () => void;
  kante: number;
  farbe: string;
  /** Gesetzt = Umschalter; der Zustand steht in `aria-pressed`, die Optik folgt daraus (CSS). */
  gedrueckt?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={beschriftung}
      aria-pressed={gedrueckt}
      title={beschriftung}
      onClick={onClick}
      className="lfh-kartenknopf"
      style={{
        width: kante,
        height: kante,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        margin: 0,
        border: 0,
        color: farbe,
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </button>
  );
}

export interface KartenUeberlagerungProps {
  /** Wahl der Kartengrundlage (`GrundlageLeiste`); `null` = steht anderswo (Handschirm). */
  grundlage: ReactNode;
  zeigerQuelle: ZeigerQuelle;
  onZoomRein: () => void;
  onZoomRaus: () => void;
  onNorden: () => void;
  /** Öffnet die Zeichenwerkzeuge der Leiste; ohne Schreibrecht nicht gesetzt → kein Knopf. */
  onZeichnen?: () => void;
  /**
   * Messwerkzeug an/aus (LFH-616). Steht auch OHNE Schreibrecht da: gemessen wird nur,
   * gespeichert nichts — anders als der Stift darunter. Nicht gesetzt (Karte ohne
   * Messwerkzeug, z. B. `personen/BetroffeneKarte.tsx`) → kein Knopf.
   */
  onMessen?: () => void;
  messenAktiv?: boolean;
}

export default function KartenUeberlagerung(props: KartenUeberlagerungProps) {
  const { token, rollen } = useRollen();
  const kante = kartenKnopfKante(token);
  const blockStil: CSSProperties = {
    position: 'absolute',
    top: UEBERLAGERUNG_RAND,
    zIndex: 5,
  };
  return (
    <>
      <div
        data-lfh="karten-ueberlagerung-links"
        style={{
          ...blockStil,
          left: UEBERLAGERUNG_RAND,
          // Platz für den Knopfblock rechts lassen — sonst überdeckt eine lange Liste von
          // Online-Stilen auf dem Handschirm die Zoomknöpfe.
          maxWidth: `calc(100% - ${kante + 3 * UEBERLAGERUNG_RAND}px)`,
          display: 'flex',
          flexDirection: 'column',
          // Nicht strecken: die Segmentleiste und die Koordinate sind so breit wie ihr Inhalt.
          alignItems: 'flex-start',
          gap: token.marginXS,
        }}
      >
        {props.grundlage}
        <ZeigerKoordinate quelle={props.zeigerQuelle} />
      </div>
      {/* Fugenraster: Knöpfe mit 1 px Fuge auf `linieStark`. */}
      <div
        role="group"
        aria-label="Kartensteuerung"
        data-lfh="karten-knoepfe"
        style={{
          ...blockStil,
          right: UEBERLAGERUNG_RAND,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          background: rollen.linieStark,
          border: `1px solid ${rollen.linieStark}`,
        }}
      >
        <Kartenknopf
          beschriftung="Hineinzoomen"
          onClick={props.onZoomRein}
          kante={kante}
          farbe={rollen.gedaempft}
        >
          <TbPlus size={16} />
        </Kartenknopf>
        <Kartenknopf
          beschriftung="Herauszoomen"
          onClick={props.onZoomRaus}
          kante={kante}
          farbe={rollen.gedaempft}
        >
          <TbMinus size={16} />
        </Kartenknopf>
        <Kartenknopf
          beschriftung="Nach Norden ausrichten"
          onClick={props.onNorden}
          kante={kante}
          farbe={rollen.gedaempft}
        >
          <TbCompass size={16} />
        </Kartenknopf>
        {/* Reihenfolge wie im Entwurf S5: Lineal vor Stift. */}
        {props.onMessen && (
          <Kartenknopf
            beschriftung="Messen"
            onClick={props.onMessen}
            kante={kante}
            farbe={props.messenAktiv ? rollen.bedien : rollen.gedaempft}
            gedrueckt={props.messenAktiv ?? false}
          >
            <TbRulerMeasure size={16} />
          </Kartenknopf>
        )}
        {props.onZeichnen && (
          <Kartenknopf
            beschriftung="Zeichenwerkzeuge"
            onClick={props.onZeichnen}
            kante={kante}
            farbe={rollen.bedien}
          >
            <TbPencil size={16} />
          </Kartenknopf>
        )}
      </div>
    </>
  );
}
