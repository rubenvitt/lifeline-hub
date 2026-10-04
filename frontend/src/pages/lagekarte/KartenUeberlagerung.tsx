import {
  IconFadenkreuz,
  IconKompass,
  IconLineal,
  IconMinus,
  IconPlus,
  IconSeitenleisteAuf,
  IconSeitenleisteZu,
  IconStandortZiel,
  IconStift,
} from '../../icons';
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Popover } from 'antd';
import {
  naechsterIndex,
  monoStil,
  segmentStil,
  segmentZelleStil,
  useRollen,
  zielEinzug,
} from '../../components/instrument';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { useZeigerLage, type ZeigerQuelle } from './mausPosition';
import type { GrundlageOption, GrundlageWert } from './leistenDaten';
import '../../theme/sprache.css';
import './lagekarte.css';

/**
 * Überlagerungen der Kartenfläche: oben links Kartengrundlage und Zeigerkoordinate, oben rechts der
 * Knopfblock (Zoom, Nordung, Eigenposition, Messen, Zeichnen, ab `lg` der Leisten-Umschalter).
 *
 * Kein aufspannender Rahmen: jeder Block ist einzeln positioniert, sonst schluckte ein Elternteil
 * über der ganzen Karte jedes Ziehen (vgl. `KartenFuss`).
 */

/** Abstand der Überlagerungen zum Kartenrand — derselbe wie der des Kartenfusses. */
export const UEBERLAGERUNG_RAND = 12;

/**
 * Die Fuge zwischen den Kartenknöpfen ist eine Haarlinie, kein Abstand: sie zeigt `linieStark`
 * durch und bleibt in jeder Dichte 1 px, wie die Fuge des Kennzahlenbands (LFH-703). Den
 * Zielabstand hält der Einzug der Zelle ({@link kartenKnopfZelleStil}).
 */
const KNOPF_FUGE = 1;

/**
 * Rasterzelle eines Kartenknopfs — rein und exportiert. Zielabstand (LFH-865, Muster LFH-630,
 * Bedien-Leitlinie Kriterium 2): der Knopf rückt in seiner Zelle um {@link zielEinzug}
 * (0 / 4 / 8 px) ab, benachbarte Knöpfe stehen so in `komfortabel` ≥ 8 px, in `handschuh`
 * ≥ 16 px auseinander, die Fuge bleibt 1 px. NUR IN STAPELRICHTUNG: der Block ist eine Spalte,
 * Nachbarn hat ein Knopf nur oben und unten. Ein Einzug auch links und rechts machte den Block
 * breiter, ohne einen Abstand zu gewinnen, und verschöbe die Kanten, an denen Kartenfuß und
 * linke Überlagerung enden (`fussStil`, `maxWidth` unten). Der Knopf behält seine Kante
 * (Treffhöhe), der Block wird je Knopf um 2 × Einzug höher. Grund der Zelle:
 * `.lfh-kartenknopf-zelle` (`lagekarte.css`); Hover, Fokus und „eingerastet“ bleiben am Knopf,
 * sie zeigen, wo ein Tippen wirkt.
 */
export function kartenKnopfZelleStil(token: { controlHeight: number }): CSSProperties {
  return { display: 'flex', paddingBlock: zielEinzug(token), paddingInline: 0 };
}

/**
 * Kantenlänge eines Kartenknopfs: der Entwurf zeichnet 32 px, die Dichte-Staffel verlangt
 * mindestens `controlHeight`. Es gilt das Größere — rein und exportiert.
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
 * die keinen gesperrten Zustand kennt. Nicht konfigurierte Grundlagen stehen gesperrt da (Grund als
 * `title`), statt zu fehlen. Dieselben Klassen und dieselbe Geometrie (`segmentStil`), Tastatur
 * nach APG mit übersprungenen Sperren.
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
   * Eine Zeile, die waagerecht scrollt, statt umzubrechen: mit mehreren Online-Stilen deckte die
   * umbrechende Leiste am Tablet das obere Drittel der Karte ab. Der Fokus holt das gewählte
   * Segment in den sichtbaren Bereich.
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
        // Zelle wie in `Segmentleiste` (Zielabstand, LFH-865); `flexShrink: 0` an der Zelle,
        // sie ist das Kind der einzeiligen Leiste.
        return (
          <span
            key={o.wert}
            role="none"
            className="lfh-segment-zelle"
            data-lfh="segment-zelle"
            style={{ ...segmentZelleStil(token), flexShrink: 0 }}
          >
            <button
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
                whiteSpace: 'nowrap',
                ...(aus ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
              }}
            >
              {o.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** Zeigerkoordinate im Format der Einsatz-Einstellungen (Mono 11, Fadenkreuz in `bedien`). */
function ZeigerKoordinate({ quelle }: { quelle: ZeigerQuelle }) {
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
        <IconFadenkreuz size={14} />
      </span>
      {lage ? formatKoordinate(lage.lat, lage.lon) : '—'}
    </div>
  );
}

/** Nur für Vorlesende sichtbar — der Grund einer Sperre steht so auch ohne Antippen am Knopf. */
const NUR_VORLESEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

function Kartenknopf({
  beschriftung,
  onClick,
  kante,
  farbe,
  gedrueckt,
  ausgeklappt,
  steuert,
  sperrGrund,
  children,
}: {
  beschriftung: string;
  onClick: () => void;
  kante: number;
  farbe: string;
  /** Gesetzt = Umschalter; der Zustand steht in `aria-pressed`, die Optik folgt daraus (CSS). */
  gedrueckt?: boolean;
  /** Gesetzt = Auf-/Zu-Schalter einer Fläche (`aria-expanded`), die `steuert` benennt. */
  ausgeklappt?: boolean;
  steuert?: string;
  /**
   * Gesetzt = gesperrt. `aria-disabled` statt `disabled`: der Knopf bleibt in der Tab-Folge und
   * nimmt den Klick — der zeigt den Grund als Text am Knopf (auf Touch der einzige Weg, ein `title`
   * erscheint dort nie); Vorlesende bekommen ihn über `aria-describedby`.
   */
  sperrGrund?: string | null;
  children: ReactNode;
}) {
  const { token } = useRollen();
  const grundId = useId();
  const knopf = (
    <button
      type="button"
      aria-label={beschriftung}
      aria-pressed={gedrueckt}
      aria-expanded={ausgeklappt}
      aria-controls={steuert}
      aria-disabled={sperrGrund != null ? true : undefined}
      aria-describedby={sperrGrund != null ? grundId : undefined}
      title={sperrGrund ?? beschriftung}
      onClick={sperrGrund != null ? undefined : onClick}
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
        // Gesperrt: Farbe und Zeiger aus `.lfh-kartenknopf[aria-disabled]` (`lagekarte.css`) — ein
        // Inline-Wert schlüge die Regel.
        ...(sperrGrund != null ? {} : { color: farbe, cursor: 'pointer' }),
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </button>
  );
  return (
    <span
      role="none"
      className="lfh-kartenknopf-zelle"
      data-lfh="kartenknopf-zelle"
      style={kartenKnopfZelleStil(token)}
    >
      {sperrGrund == null ? (
        knopf
      ) : (
        <>
          <Popover trigger={['click']} placement="left" content={sperrGrund}>
            {knopf}
          </Popover>
          <span id={grundId} style={NUR_VORLESEN}>
            {sperrGrund}
          </span>
        </>
      )}
    </span>
  );
}

interface KartenUeberlagerungProps {
  /** Wahl der Kartengrundlage (`GrundlageLeiste`); `null` = steht anderswo (Handschirm). */
  grundlage: ReactNode;
  zeigerQuelle: ZeigerQuelle;
  onZoomRein: () => void;
  onZoomRaus: () => void;
  onNorden: () => void;
  /** Öffnet die Zeichenwerkzeuge der Leiste; ohne Schreibrecht nicht gesetzt → kein Knopf. */
  onZeichnen?: () => void;
  /**
   * Messwerkzeug an/aus. Steht auch ohne Schreibrecht da: gemessen wird nur, gespeichert nichts.
   * Nicht gesetzt (z. B. `personen/BetroffeneKarte.tsx`) → kein Knopf.
   */
  onMessen?: () => void;
  messenAktiv?: boolean;
  /**
   * Eigenposition: Umschalter, auch ohne Schreibrecht. `sperrGrund` gesetzt → gesperrt mit Grund.
   * Nicht gesetzt → kein Knopf.
   */
  eigenposition?: { an: boolean; sperrGrund: string | null; onUmschalten: () => void };
  /**
   * Leiste ein-/ausblenden, nur ab `lg`: dort steht der Umschalter an der Leistenkante. Im
   * Seitenkopf hob ein 72-px-Knopf den Kopf so weit, dass die Zeitachse am Tablet über die Hälfte
   * der Karte belegte (`e2e/leisten-flaeche.spec.ts`). Unter `lg` steht er im Seitenkopf.
   */
  leiste?: { sichtbar: boolean; sperrGrund: string | null; onUmschalten: () => void };
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
          // Platz für den Knopfblock lassen — sonst überdeckt eine lange Stil-Liste die Zoomknöpfe.
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
      {/* Fugenraster: Knopfzellen mit 1 px Fuge auf `linieStark`, Einzug in der Zelle (LFH-865). */}
      <div
        role="group"
        aria-label="Kartensteuerung"
        data-lfh="karten-knoepfe"
        style={{
          ...blockStil,
          right: UEBERLAGERUNG_RAND,
          display: 'flex',
          flexDirection: 'column',
          gap: KNOPF_FUGE,
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
          <IconPlus size={16} />
        </Kartenknopf>
        <Kartenknopf
          beschriftung="Herauszoomen"
          onClick={props.onZoomRaus}
          kante={kante}
          farbe={rollen.gedaempft}
        >
          <IconMinus size={16} />
        </Kartenknopf>
        <Kartenknopf
          beschriftung="Nach Norden ausrichten"
          onClick={props.onNorden}
          kante={kante}
          farbe={rollen.gedaempft}
        >
          <IconKompass size={16} />
        </Kartenknopf>
        {/* Eigenposition gehört zur Navigation (wohin schaue ich?), deshalb vor den Werkzeugen. */}
        {props.eigenposition && (
          <Kartenknopf
            beschriftung="Eigenposition"
            onClick={props.eigenposition.onUmschalten}
            kante={kante}
            farbe={props.eigenposition.an ? rollen.bedien : rollen.gedaempft}
            gedrueckt={props.eigenposition.an}
            sperrGrund={props.eigenposition.sperrGrund}
          >
            <IconStandortZiel size={16} />
          </Kartenknopf>
        )}
        {/* Reihenfolge wie im Entwurf S5: Lineal vor Stift. */}
        {props.onMessen && (
          <Kartenknopf
            beschriftung="Messen"
            onClick={props.onMessen}
            kante={kante}
            farbe={props.messenAktiv ? rollen.bedien : rollen.gedaempft}
            gedrueckt={props.messenAktiv ?? false}
          >
            <IconLineal size={16} />
          </Kartenknopf>
        )}
        {props.onZeichnen && (
          <Kartenknopf
            beschriftung="Zeichenwerkzeuge"
            onClick={props.onZeichnen}
            kante={kante}
            farbe={rollen.bedien}
          >
            <IconStift size={16} />
          </Kartenknopf>
        )}
        {props.leiste && (
          <Kartenknopf
            beschriftung={props.leiste.sichtbar ? 'Leiste ausblenden' : 'Leiste einblenden'}
            onClick={props.leiste.onUmschalten}
            kante={kante}
            farbe={rollen.gedaempft}
            ausgeklappt={props.leiste.sichtbar}
            steuert="lagekarte-leiste"
            sperrGrund={props.leiste.sperrGrund}
          >
            {props.leiste.sichtbar ? (
              <IconSeitenleisteZu size={16} />
            ) : (
              <IconSeitenleisteAuf size={16} />
            )}
          </Kartenknopf>
        )}
      </div>
    </>
  );
}
