import { SeitenLeer } from '../components/SeitenZustand';
import type { Nachforderung, NachforderungStatus } from '../api/types';
import NachforderungKarte from './NachforderungKarte';

export interface NachforderungListeProps {
  nachforderungen: Nachforderung[];
  /** Steuert die Übergangs-Zeitstempel/Grund-Zeilen in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
}

/** Kartenboard der Nachforderungen (LFH-112). Reicht alle Props an die einzelne
 *  NachforderungKarte durch; Darstellung/Logik liegen vollständig in der Karte. */
export default function NachforderungListe({
  nachforderungen,
  ansicht = 'offen',
  darfSchreiben,
  onStatus,
  onAblehnen,
}: NachforderungListeProps) {
  if (nachforderungen.length === 0) return <SeitenLeer titel="Keine Nachforderungen" />;
  return (
    <>
      {nachforderungen.map((n) => (
        <NachforderungKarte
          key={n.id}
          nachforderung={n}
          ansicht={ansicht}
          darfSchreiben={darfSchreiben}
          onStatus={onStatus}
          onAblehnen={onAblehnen}
        />
      ))}
    </>
  );
}
