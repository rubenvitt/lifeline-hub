import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeStandVerlauf } from '../api/evakuierung';
import { einsatzKeys } from '../api/queryKeys';
import type { StandVerlaufEintrag } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { monoStil, useRollen } from '../components/instrument';
import { personenZahl } from './betreuungText';
import { standStufen, stufenAussage, stufenGeometrie, type StandStufe } from './standlinieKern';
import { zeitKurz } from '../anzeige/zeitDarstellung';

const BREITE = 600;
const HOEHE = 96;
/** Rand oben und unten in viewBox-Einheiten, damit Strich und Punkte nicht abgeschnitten werden. */
const RAND = 6;
/** Durchmesser der Meldepunkte (≥ 8 px). */
const PUNKT = 8;

/** Wire-Zeit einer Stufe zurück in den Wire-String für die Zeitanzeige. */
function wire(t: number): string {
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Stufenlinie „Stand evakuiert über die Zeit“ eines Bezirks (LLH-1076, design.md D7). Eigenes SVG
 * ohne Diagrammpaket (Muster `wetter/Verlaufslinie.tsx`); Regeln im Kern `standlinieKern.ts`:
 * nur gültige Meldungen, Stufe statt Schräge, Ende an der jüngsten Meldung, y ab 0.
 *
 * Eine Reihe: keine Legende, die Linie trägt die Bedienfarbe nicht (sie ist kein Bedienziel) und
 * keine Statusfarbe (kein Zustand), sondern die Textfarbe; die Plangröße steht gestrichelt mit Wort
 * und Zahl daneben. Zugänglich als EIN Bild mit Aussage; Beschriftungen sind `aria-hidden`. Je
 * Punkt nennt ein `<title>` Zahl und Zeit für den Zeiger. Die Tabelle dazu ist der Verlauf darunter.
 *
 * Mit weniger als zwei Meldungen entfällt die Linie ganz (Abwesenheit, keine leere Achse).
 */
export default function BezirkStandlinie({
  einsatzId,
  bezirkId,
  plan,
}: {
  einsatzId: number;
  bezirkId: number;
  plan: number;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  // Dieselbe Abfrage wie `MeldeVerlauf` (ein Schlüssel, ein Abruf), eigenes `select`.
  const abfrage = useQuery<StandVerlaufEintrag[], Error, StandStufe[]>({
    queryKey: einsatzKeys.evakuierungVerlauf(einsatzId, bezirkId),
    queryFn: () => ladeStandVerlauf(einsatzId, bezirkId),
    select: standStufen,
  });
  const stufen = useMemo(() => abfrage.data ?? [], [abfrage.data]);
  const g = stufenGeometrie(stufen, plan, BREITE, HOEHE);
  if (!g) return null;

  const zeit = (s: StandStufe) => zeitKurz(wire(s.t), konventionen);
  const erste = stufen[0];
  const letzte = stufen[stufen.length - 1];
  const beschriftung = { ...monoStil(11), color: rollen.schwach };

  return (
    <figure data-lfh="bezirk-standlinie" style={{ margin: 0, marginBottom: token.marginSM }}>
      <svg
        role="img"
        aria-label={stufenAussage(stufen, plan, zeit(erste), zeit(letzte))}
        viewBox={`0 ${-RAND} ${BREITE} ${HOEHE + 2 * RAND}`}
        width="100%"
        style={{ display: 'block', maxHeight: 140, overflow: 'visible' }}
      >
        <g aria-hidden="true">
          {/* Grundlinie bei 0: zurückhaltend, ohne Raster. */}
          <line x1={0} x2={BREITE} y1={HOEHE} y2={HOEHE} stroke={rollen.linie} strokeWidth={1} />
          <line
            data-lfh="standlinie-plan"
            x1={0}
            x2={BREITE}
            y1={g.planY}
            y2={g.planY}
            stroke={rollen.gedaempft}
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={g.d}
            fill="none"
            stroke={rollen.text}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {g.punkte.map((p) => (
            <circle
              key={p.stufe.t}
              cx={p.x}
              cy={p.y}
              r={PUNKT / 2}
              fill={rollen.text}
              stroke={rollen.paneel}
              strokeWidth={2}
            >
              <title>{`${p.stufe.geschaetzt ? '≈ ' : ''}${personenZahl(p.stufe.evakuiert)} evakuiert · ${zeit(p.stufe)}`}</title>
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
        <span>
          <span style={{ letterSpacing: 2 }}>- - </span>
          {`Plangröße ${personenZahl(plan)}`}
        </span>
        <span>{zeit(letzte)}</span>
      </figcaption>
    </figure>
  );
}
