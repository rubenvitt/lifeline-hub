import { SeitenLeer } from '../components/SeitenZustand';
import type { Nachforderung, NachforderungStatus } from '../api/types';
import NachforderungKarte from './NachforderungKarte';
import type { ZeilenGrund } from '../components/useZeilenFehler';

interface NachforderungListeProps {
  nachforderungen: Nachforderung[];
  /** Steuert die Übergangs-Zeitstempel/Grund-Zeilen in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
  /**
   * Grund der zuletzt abgelehnten Fortschaltung je Nachforderung (`grund` aus
   * `components/useZeilenFehler.ts`). Jede Karte bekommt nur ihren Grund, ein stabiles Objekt: die
   * übrigen bleiben gemerkt (LFH-1077).
   */
  kartenFehler?: (id: number) => ZeilenGrund | null;
}

/** Kartenboard der Nachforderungen; Darstellung und Logik liegen in der Karte. */
export default function NachforderungListe({
  nachforderungen,
  ansicht = 'offen',
  darfSchreiben,
  onStatus,
  onAblehnen,
  kartenFehler,
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
          fehlerGrund={kartenFehler?.(n.id) ?? null}
        />
      ))}
    </>
  );
}
