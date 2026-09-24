import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Auftrag } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { AUFTRAG_STATUS, istAbgeschlossen } from '../kommunikation';
import AuftragKarte from './AuftragKarte';

/**
 * Lese-Vorschau eines Auftrags in der Sprungpalette (LFH-664, Design Entscheidung 5).
 *
 * Kein eigener Lese-Inhalt, sondern DIE Karte der Auftragsseite — gleicher Datensatz, gleiche
 * Gestalt. Ohne `darfSchreiben` und ohne Callbacks rendert sie keine Aktion: kein
 * „quittieren" (die Zeile „Quittung offen:" bleibt samt Namen stehen, nur der Knopf fehlt),
 * kein „In Bearbeitung", „Vollzug melden" oder „Abnehmen". Belegt in `AuftragVorschau.test.tsx`.
 *
 * Das Befehlsschema bleibt hinter „Befehlsdetails" eingeklappt, wie auf der Seite: das
 * Aufklappen ändert keinen Datensatz, und eine eigene Prop für eine offene Vorschau wäre ein
 * Unterschied zwischen zwei Darstellungen desselben Auftrags ohne Not.
 *
 * `einsatzId` geht mit, obwohl die Karte sie als optional führt — ohne sie fiele der
 * Rückverweis „↗ ETB-Eintrag" still weg. Die `ansicht` folgt dem Datensatz, wie die Seite sie
 * wählt (`AuftraegeListe`): ein abgeschlossener Auftrag zeigt Vollzug, Abnahme und Vermerk.
 *
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
