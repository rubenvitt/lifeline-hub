import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EinsatzPersonal } from '../api/types';
import { POSITION_LABELS } from '../api/personal';
import StatusTag from '../components/StatusTag';
import { Datenfeld, Datenraster } from '../components/instrument';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { personalStatusDarstellung } from './mittelStatus';

/**
 * Lese-Vorschau einer disponierten Einsatzkraft in der Sprungpalette. Daten aus dem Listenfach
 * der Palette mit `select` auf die `id`; Status als `StatusTag`, die Mandantenfarbe erzwingt
 * die Rand-Form. Einheit und Fahrzeug fehlen (nur IDs in der Liste). Leere optionale Angaben
 * fehlen ganz.
 */
export default function PersonalVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: EinsatzPersonal[]) => liste.find((p) => p.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.personal(einsatzId), select });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Die Einsatzkraft">
      {(p) => (
        <Datenraster spalten={2} beschriftung={`Einsatzkraft ${p.name}`}>
          <Datenfeld label="Name">{p.name}</Datenfeld>
          <Datenfeld label="Status">
            <StatusTag darstellung={personalStatusDarstellung(p)} farbe={p.status_farbe} />
          </Datenfeld>
          {p.funktion && <Datenfeld label="Funktion">{p.funktion}</Datenfeld>}
          {p.traegerorganisation && (
            <Datenfeld label="Trägerorganisation">{p.traegerorganisation}</Datenfeld>
          )}
          {p.staerke_position && (
            <Datenfeld label="Stärkeposition">{POSITION_LABELS[p.staerke_position]}</Datenfeld>
          )}
          {p.ist_adhoc && <Datenfeld label="Herkunft">ad-hoc</Datenfeld>}
          {p.bemerkung && (
            <Datenfeld label="Bemerkung" breit>
              {p.bemerkung}
            </Datenfeld>
          )}
        </Datenraster>
      )}
    </VorschauZustand>
  );
}
