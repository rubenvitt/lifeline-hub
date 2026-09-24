import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Einsatzabschnitt } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../../command-palette/VorschauZustand';
import AbschnittDaten from './AbschnittDaten';
import { abschnittStaerken } from './abschnittStaerke';

/**
 * Lese-Vorschau eines Einsatzabschnitts in der Sprungpalette (LFH-664) — die Angaben aus dem
 * Lesezweig der Abschnittsseite (`AbschnittDaten`), ohne Bearbeiten und Auflösen.
 *
 * ZWEI Fächer der Palette: die Abschnittsliste trägt den Datensatz, die Einheitenliste die
 * Stärke. Die Stärke „inkl. Unterabschnitte" braucht den ganzen Baum (`nachfahrenInkl`),
 * deshalb liefert `select` neben dem Abschnitt die Liste mit; fehlt der Abschnitt, bleibt das
 * Ergebnis `undefined`, und `VorschauZustand` sagt „nicht mehr vorhanden".
 *
 * Die Einheitenliste blockiert den Abschnitt nicht: lädt sie noch oder scheitert sie, steht
 * der Abschnitt trotzdem da und die Stärke sagt, warum sie fehlt. Ein „—" an ihrer Stelle
 * hieße „keine Einheit zugeordnet" — das wäre eine Aussage ohne Messung.
 */
export default function AbschnittVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const { rollen } = useRollen();
  const select = useCallback(
    (liste: Einsatzabschnitt[]) => {
      const abschnitt = liste.find((a) => a.id === id);
      return abschnitt ? { abschnitt, alle: liste } : undefined;
    },
    [id],
  );
  const abfrage = useQuery({ ...datensatzAbfrage.abschnitte(einsatzId), select });
  const einheitenAbfrage = useQuery(datensatzAbfrage.einheiten(einsatzId));
  const einheiten = einheitenAbfrage.data;

  return (
    <VorschauZustand abfrage={abfrage} sorte="Der Einsatzabschnitt">
      {({ abschnitt, alle }) => (
        <AbschnittDaten
          abschnitt={abschnitt}
          staerken={einheiten ? abschnittStaerken(alle, einheiten, abschnitt.id) : undefined}
          staerkenErsatz={
            <span style={{ color: rollen.gedaempft }}>
              {einheitenAbfrage.isError ? 'nicht abrufbar' : 'wird geladen …'}
            </span>
          }
          spalten={2}
        />
      )}
    </VorschauZustand>
  );
}
