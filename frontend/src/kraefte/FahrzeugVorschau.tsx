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
 * Lese-Vorschau eines disponierten Fahrzeugs in der Sprungpalette.
 *
 * DATEN: das Listenfach der Palette mit `select` auf die `id` — nach einem Treffer warm und am
 * Live-Stream, ein Statuswechsel kommt ohne Neuöffnen an.
 * NUR LESEN: Status als `StatusTag` mit Wort; die Mandantenfarbe erzwingt die Rand-Form.
 * WEGGELASSEN, was die Liste nicht trägt (Einheitsname, Ist-Besatzung, Position). Leere
 * optionale Angaben fehlen ganz.
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
