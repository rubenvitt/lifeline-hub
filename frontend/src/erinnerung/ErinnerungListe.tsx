import { SeitenLeer } from '../components/SeitenZustand';
import type { Erinnerung } from '../api/types';
import ErinnerungKarte from './ErinnerungKarte';

export interface ErinnerungListeProps {
  erinnerungen: Erinnerung[];
  /** Steuert die Abschluss-Spalten (Erledigt/Quittiert-Zeitpunkt) in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben: boolean;
  onErledigen: (id: number) => void;
  onQuittieren: (id: number) => void;
}

/** Kartenboard der Erinnerungen (LFH-112). Reicht alle Props an die einzelne
 *  ErinnerungKarte durch; Darstellung/Logik liegen vollständig in der Karte. */
export default function ErinnerungListe({
  erinnerungen,
  ansicht = 'offen',
  darfSchreiben,
  onErledigen,
  onQuittieren,
}: ErinnerungListeProps) {
  if (erinnerungen.length === 0) return <SeitenLeer titel="Keine Erinnerungen" />;
  return (
    <>
      {erinnerungen.map((e) => (
        <ErinnerungKarte
          key={e.id}
          erinnerung={e}
          ansicht={ansicht}
          darfSchreiben={darfSchreiben}
          onErledigen={onErledigen}
          onQuittieren={onQuittieren}
        />
      ))}
    </>
  );
}
