import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Auftrag } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { AUFTRAG_STATUS, istAbgeschlossen } from '../kommunikation';
import AuftragKarte from './AuftragKarte';

/**
 * Lese-Vorschau eines Auftrags in der Sprungpalette: DIE Karte der Auftragsseite. Ohne
 * `darfSchreiben` und Callbacks rendert sie keine Aktion (die Zeile „Quittung offen:" bleibt
 * samt Namen, nur der Knopf fehlt). Das Befehlsschema bleibt wie auf der Seite eingeklappt.
 *
 * `einsatzId` geht mit, sonst fiele der Rückverweis „↗ ETB-Eintrag" still weg. Die `ansicht`
 * folgt dem Datensatz wie auf der Seite.
 * Daten aus dem Listenfach der Palette ({@link datensatzAbfrage}), per `select` auf die `id`.
 */
export default function AuftragVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: Auftrag[]) => liste.find((a) => a.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.auftraege(einsatzId), select });
  return (
    <VorschauZustand abfrage={abfrage} sorte="Der Auftrag">
      {(a) => (
        <AuftragKarte
          einsatzId={einsatzId}
          auftrag={a}
          ansicht={
            istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen')
              ? 'abgeschlossen'
              : 'offen'
          }
        />
      )}
    </VorschauZustand>
  );
}
