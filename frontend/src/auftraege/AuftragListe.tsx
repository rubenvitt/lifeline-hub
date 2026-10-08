import { useMemo, useRef } from 'react';
import { SeitenLeer } from '../components/SeitenZustand';
import { useDruckModus } from '../components/druck/useDruckModus';
import {
  FENSTER_EINTRAG,
  FENSTER_ENDE,
  useFensterAusschnitt,
} from '../components/fensterAusschnitt';
import type { Auftrag, AuftragEmpfaenger } from '../api/types';
import AuftragKarte from './AuftragKarte';

interface AuftragListeProps {
  auftraege: Auftrag[];
  /** Steuert die Read-back-Spalten (Vollzug/Abnahme) in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  /** Für den Rückverweis auf den Quell-ETB-Eintrag. Ohne ihn kein Backlink. */
  einsatzId?: number;
  darfSchreiben?: boolean;
  /** Hervorzuhebender Auftrag (?auftrag=-Deeplink). */
  highlightId?: number | null;
  quittierungLaeuft?: boolean;
  quittierungZiel?: { auftragId: number; empfaengerId: number } | null;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  /** Welche Empfängerzeilen quittierbar sind; ohne: alle. */
  darfQuittierenFuer?: (empfaenger: AuftragEmpfaenger) => boolean;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
  /** Ab {@link AUFTRAG_SCHWELLE} Aufträgen nur den Sichtbereich rendern (LFH-949, D6). */
  fenster?: boolean;
}

/** Ab wie vielen Aufträgen eine Liste mit `fenster` nur ihren Ausschnitt rendert. */
export const AUFTRAG_SCHWELLE = 50;
/** Startschätzung einer Karte, bis gemessen ist (px). */
const KARTE_SCHAETZUNG = 160;

/** Kartenboard der Aufträge/Befehle; Darstellung und Logik liegen in der Karte. */
export default function AuftragListe({
  auftraege,
  ansicht = 'offen',
  einsatzId,
  darfSchreiben,
  highlightId,
  quittierungLaeuft,
  quittierungZiel,
  onQuittieren,
  darfQuittierenFuer,
  onInArbeit,
  onVollzugMelden,
  onAbnehmen,
  fenster = false,
}: AuftragListeProps) {
  const druckt = useDruckModus();
  const virtuell = fenster && !druckt && auftraege.length > AUFTRAG_SCHWELLE;
  const wurzel = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLDivElement>(null);
  const schluessel = useMemo(() => auftraege.map((a) => a.id), [auftraege]);
  // `?auftrag=` (D3/D6): der Ausschnitt schließt den Auftrag ein und zeigt ihn.
  const { von, bis, oben, unten } = useFensterAusschnitt({
    schluessel,
    aktiv: virtuell,
    schaetzung: KARTE_SCHAETZUNG,
    start,
    wurzel,
    anker: highlightId ?? null,
  });

  if (auftraege.length === 0) return <SeitenLeer titel="Keine Aufträge" />;
  const karte = (a: Auftrag) => (
    <AuftragKarte
      key={a.id}
      auftrag={a}
      ansicht={ansicht}
      einsatzId={einsatzId}
      darfSchreiben={darfSchreiben}
      hervorgehoben={a.id === highlightId}
      quittierungLaeuft={quittierungLaeuft}
      // Nur die betroffene Karte sieht das Ziel; die übrigen bleiben gemerkt.
      quittierungZiel={quittierungZiel?.auftragId === a.id ? quittierungZiel : null}
      onQuittieren={onQuittieren}
      darfQuittierenFuer={darfQuittierenFuer}
      onInArbeit={onInArbeit}
      onVollzugMelden={onVollzugMelden}
      onAbnehmen={onAbnehmen}
    />
  );
  if (!virtuell) return <>{auftraege.map(karte)}</>;
  return (
    <div ref={wurzel}>
      <div ref={start} aria-hidden data-lfh="auftraege-platzhalter" style={{ height: oben }} />
      {auftraege.slice(von, bis).map((a) => (
        <div key={a.id} {...{ [FENSTER_EINTRAG]: String(a.id) }}>
          {karte(a)}
        </div>
      ))}
      <div
        aria-hidden
        data-lfh="auftraege-platzhalter"
        {...{ [FENSTER_ENDE]: '' }}
        style={{ height: unten }}
      />
    </div>
  );
}
