import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { monoStil, useRollen } from '../components/instrument';
import { stufenGeometrie, type Stufe } from './standlinieKern';

const BREITE = 600;
const HOEHE = 96;
/** Rand oben und unten in viewBox-Einheiten, damit Strich und Punkte nicht abgeschnitten werden. */
const RAND = 6;
/** Durchmesser der Meldepunkte (≥ 8 px). */
const PUNKT = 8;
/** Höchste Bildhöhe in px. */
const MAX_HOEHE = 140;
/**
 * Höchste Breite der Figur: die Breite, bei der das Bild seine Höchsthöhe erreicht. Breiter
 * schrumpfte das SVG mittig in sein Seitenverhältnis, und die Zeiten der Beschriftung stünden
 * nicht mehr unter den Enden der Linie.
 */
const MAX_BREITE = Math.floor((MAX_HOEHE * BREITE) / (HOEHE + 2 * RAND));

/** Wire-Zeit einer Stufe zurück in den Wire-String für die Zeitanzeige. */
function wire(t: number): string {
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Stufenlinie einer Meldereihe über die Zeit (LLH-1076, design.md D7; seit LLH-1347 auch die
 * Belegung einer Betreuungsstelle). Eigenes SVG ohne Diagrammpaket (Muster
 * `wetter/Verlaufslinie.tsx`); Regeln im Kern `standlinieKern.ts`: nur gültige Meldungen, Stufe
 * statt Schräge, Ende an der jüngsten Meldung, y ab 0.
 *
 * Eine Reihe: keine Legende, die Linie trägt die Bedienfarbe nicht (sie ist kein Bedienziel) und
 * keine Statusfarbe (kein Zustand), sondern die Textfarbe; die Bezugsgröße (Plangröße, Kapazität)
 * steht gestrichelt mit Wort und Zahl daneben. Zugänglich als EIN Bild mit Aussage; Beschriftungen
 * sind `aria-hidden`. Je Punkt nennt ein `<title>` Zahl und Zeit für den Zeiger. Die Tabelle dazu
 * ist der Verlauf darunter.
 *
 * Mit weniger als zwei Meldungen entfällt die Linie ganz (Abwesenheit, keine leere Achse).
 */
export default function Stufenlinie({
  stufen,
  bezug,
  aussage,
  punktTitel,
  kennung,
}: {
  stufen: readonly Stufe[];
  /** Gestrichelte Bezugslinie mit Wortlaut („Plangröße 380“); `null` ohne Bezugsgröße. */
  bezug: { wert: number; text: string } | null;
  /** Zugänglicher Name des Bildes; `von`/`bis` sind die formatierten Zeiten der Enden. */
  aussage: (von: string, bis: string) => string;
  /** Text am Punkt für den Zeiger. */
  punktTitel: (stufe: Stufe, zeit: string) => string;
  /** `data-lfh` der Figur. */
  kennung: string;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const g = stufenGeometrie(stufen, bezug?.wert ?? null, BREITE, HOEHE);
  if (!g) return null;

  const zeit = (s: Stufe) => zeitKurz(wire(s.t), konventionen);
  const erste = stufen[0];
  const letzte = stufen[stufen.length - 1];
  const beschriftung = { ...monoStil(11), color: rollen.schwach };

  return (
    <figure
      data-lfh={kennung}
      style={{ margin: 0, marginBottom: token.marginSM, maxWidth: MAX_BREITE }}
    >
      <svg
        role="img"
        aria-label={aussage(zeit(erste), zeit(letzte))}
        viewBox={`0 ${-RAND} ${BREITE} ${HOEHE + 2 * RAND}`}
        width="100%"
        style={{ display: 'block', maxHeight: MAX_HOEHE, overflow: 'visible' }}
      >
        <g aria-hidden="true">
          {/* Grundlinie bei 0: zurückhaltend, ohne Raster. */}
          <line x1={0} x2={BREITE} y1={HOEHE} y2={HOEHE} stroke={rollen.linie} strokeWidth={1} />
          {g.bezugY != null && (
            <line
              data-lfh="standlinie-bezug"
              x1={0}
              x2={BREITE}
              y1={g.bezugY}
              y2={g.bezugY}
              stroke={rollen.gedaempft}
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            data-lfh="standlinie-stufen"
            d={g.d}
            fill="none"
            stroke={rollen.text}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {g.punkte.map((p, i) => (
            <circle
              // Position statt Zeit: zwei gültige Meldungen können denselben Zeitpunkt tragen.
              key={i}
              cx={p.x}
              cy={p.y}
              r={PUNKT / 2}
              fill={rollen.text}
              stroke={rollen.paneel}
              strokeWidth={2}
            >
              <title>{punktTitel(p.stufe, zeit(p.stufe))}</title>
            </circle>
          ))}
        </g>
      </svg>
      <figcaption
        aria-hidden="true"
        style={{
          ...beschriftung,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: token.marginXS,
          marginTop: token.marginXXS,
        }}
      >
        <span>{zeit(erste)}</span>
        {bezug && (
          <span>
            <span style={{ letterSpacing: 2 }}>- - </span>
            {bezug.text}
          </span>
        )}
        <span>{zeit(letzte)}</span>
      </figcaption>
    </figure>
  );
}
