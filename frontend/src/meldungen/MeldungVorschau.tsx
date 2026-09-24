import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Meldung } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { MELDUNG_STATUS, istAbgeschlossen } from '../kommunikation';
import MeldungKarte from './MeldungKarte';

/**
 * Lese-Vorschau einer Meldung in der Sprungpalette (LFH-664, Design Entscheidung 5).
 *
 * Kein eigener Lese-Inhalt, sondern DIE Karte der Meldungsseite — gleicher Datensatz, gleiche
 * Gestalt. Ein Nur-Lesen-Modus der Karte ist nicht nötig: ohne `darfSchreiben` und ohne
 * Callbacks rendert sie keine Aktion (die Riegel sitzen in der Ableitung, nicht am Rendern),
 * und das belegt `MeldungVorschau.test.tsx` am schlimmsten Fall. Der Verweis „↗ Auftrag"
 * bleibt ein Link; die Palette schließt sich beim Klick darauf selbst (Entscheidung 8).
 *
 * Die `ansicht` folgt dem Datensatz, wie die Seite sie wählt (`MeldungenPage`): eine erledigte
 * Meldung steht dort in der Abgeschlossen-Ansicht und zeigt ihre Erledigt-Zeit — die Vorschau
 * zeigt nicht weniger als die Seite, die sie ankündigt.
 *
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
