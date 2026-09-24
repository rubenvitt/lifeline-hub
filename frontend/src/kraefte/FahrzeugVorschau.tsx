import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EinsatzFahrzeug } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StatusTag from '../components/StatusTag';
import { Datenfeld, Datenraster } from '../components/instrument';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { fahrzeugStatusDarstellung } from './mittelStatus';

/**
 * Lese-Vorschau eines disponierten Fahrzeugs in der Sprungpalette (LFH-664).
 *
 * DATEN: das Listenfach der Palette (`datensatzAbfrage.fahrzeuge`) mit `select` auf die `id` —
 * dasselbe Fach, dieselbe Abruffunktion, dieselbe Frische. Nach einem Treffer ist es warm
 * (kein Abruf) und hängt am Live-Stream: ein Statuswechsel von anderer Stelle kommt ohne
 * Neuöffnen an.
 *
 * NUR LESEN: der Status steht als `StatusTag` mit Wort, nicht als `StatusWahl` der Seite. Die
 * Mandantenfarbe (`status_farbe`) geht an `farbe` und erzwingt damit die Rand-Form.
 *
 * WEGGELASSEN, weil die Liste es nicht trägt oder es nur über einen weiteren Abruf ginge:
 * die Einheit (nur `einheit_id`, der Name stünde erst in der Einheitenliste), die
 * Ist-Besatzung (zählt die Personalliste), die Position auf der Karte. Leere optionale Angaben
 * fehlen ganz, statt als Platzhalter dazustehen.
 */
export default function FahrzeugVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: EinsatzFahrzeug[]) => liste.find((f) => f.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.fahrzeuge(einsatzId), select });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Das Fahrzeug">
      {(f) => (
        <Datenraster spalten={2} beschriftung={`Fahrzeug ${f.funkrufname}`}>
          <Datenfeld label="Funkrufname" mono>
            {f.funkrufname}
          </Datenfeld>
          <Datenfeld label="Status">
            <StatusTag darstellung={fahrzeugStatusDarstellung(f)} farbe={f.status_farbe} />
          </Datenfeld>
          {f.fahrzeugtyp && <Datenfeld label="Fahrzeugtyp">{f.fahrzeugtyp}</Datenfeld>}
          {f.kennzeichen && (
            <Datenfeld label="Kennzeichen" mono>
              {f.kennzeichen}
            </Datenfeld>
          )}
          {f.opta && (
            <Datenfeld label="OPTA" mono>
              {f.opta}
            </Datenfeld>
          )}
          {f.traegerorganisation && (
            <Datenfeld label="Trägerorganisation">{f.traegerorganisation}</Datenfeld>
          )}
          {f.soll_besatzung && (
            <Datenfeld label="Soll-Besatzung (F/UF/M//Σ)" mono>
              <StaerkeAnzeige wert={f.soll_besatzung} />
            </Datenfeld>
          )}
          {f.ist_adhoc && <Datenfeld label="Herkunft">ad-hoc</Datenfeld>}
          {f.bemerkung && (
            <Datenfeld label="Bemerkung" breit>
              {f.bemerkung}
            </Datenfeld>
          )}
        </Datenraster>
      )}
    </VorschauZustand>
  );
}
