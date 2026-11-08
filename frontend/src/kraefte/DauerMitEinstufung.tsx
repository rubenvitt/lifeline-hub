import type { CSSProperties } from 'react';
import type { SchichtplanGrenzwerte } from '../api/types';
import { monoStil, useRollen } from '../components/instrument';
import { dauerText, EINSTUFUNG_WORT, einstufungText, type Einstufung } from './zeitachse';

/** Nur für Screenreader: sehend steht die Beschreibung im `title`. */
const NUR_VORGELESEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

interface DauerMitEinstufungProps {
  minuten: number;
  /** Aus `stufeEin`; ohne Grenzwerte wird sie nicht gezeigt. */
  einstufung: Einstufung | null;
  grenzwerte: SchichtplanGrenzwerte | undefined;
  zeit: (utc: string) => string;
  /** Beschreibung, die die Zelle schon ohne Einstufung trägt (z. B. der Anker). */
  zusatz?: string;
  lfh?: string;
}

/**
 * Dauer der Kräfte-Zeitachse mit Einstufung (LLH-730, Spec `kraefte-zeitachse`, „Einstufung
 * gegen die Grenzwerte des Einsatzes“): die Zahl in Mono, daneben das Wort in der Rolle
 * `achtung` als zweiter Kanal, die Begründung im `title` und vorgelesen. Ohne Einstufung bleibt
 * die Zelle, wie sie war. Nur Meldebild „Im Einsatz“ und Personal „Einsatzdauer“
 * (`kraefte/AGENTS.md`).
 */
export default function DauerMitEinstufung({
  minuten,
  einstufung,
  grenzwerte,
  zeit,
  zusatz,
  lfh,
}: DauerMitEinstufungProps) {
  const { rollen } = useRollen();
  const begruendung =
    einstufung && grenzwerte ? einstufungText(einstufung, grenzwerte, zeit) : null;
  const titel = [zusatz, begruendung].filter((t): t is string => !!t).join(' · ') || undefined;
  return (
    <span data-lfh={lfh} title={titel} style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>
      {dauerText(minuten)}
      {begruendung && einstufung && (
        <>
          {' '}
          <span data-lfh="dauer-einstufung" style={{ color: rollen.achtungText }}>
            {EINSTUFUNG_WORT[einstufung.wort]}
          </span>
        </>
      )}
      {(zusatz || begruendung) && (
        <span style={NUR_VORGELESEN}>
          {zusatz ? `, ${zusatz}` : ''}
          {begruendung ? `. ${begruendung}` : ''}
        </span>
      )}
    </span>
  );
}
