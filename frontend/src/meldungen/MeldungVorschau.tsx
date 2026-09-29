import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Meldung } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { MELDUNG_STATUS, istAbgeschlossen } from '../kommunikation';
import MeldungKarte from './MeldungKarte';

/**
 * Lese-Vorschau einer Meldung in der Sprungpalette: DIE Karte der Meldungsseite. Ohne
 * `darfSchreiben` und Callbacks rendert sie keine Aktion (die Riegel sitzen in der Ableitung).
 * Der Verweis „↗ Auftrag" bleibt ein Link; die Palette schließt sich beim Klick selbst.
 *
 * Die `ansicht` folgt dem Datensatz wie auf der Seite (erledigt → Abgeschlossen-Ansicht).
 * Daten aus dem Listenfach der Palette ({@link datensatzAbfrage}), per `select` auf die `id`.
 */
export default function MeldungVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: Meldung[]) => liste.find((m) => m.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.meldungen(einsatzId), select });
  return (
    <VorschauZustand abfrage={abfrage} sorte="Die Meldung">
      {(m) => (
        <MeldungKarte
          einsatzId={einsatzId}
          meldung={m}
          ansicht={
            istAbgeschlossen(MELDUNG_STATUS[m.status]?.phase ?? 'offen') ? 'abgeschlossen' : 'offen'
          }
        />
      )}
    </VorschauZustand>
  );
}
