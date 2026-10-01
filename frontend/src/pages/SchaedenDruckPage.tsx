import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeSchaeden } from '../api/einsatzSchaden';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import ListenDruckSeite from '../druck/ListenDruckSeite';
import { umfangText } from '../druck/umfang';
import { parseSchaedenDruckAuswahl, schaedenPfad } from '../routing/deeplinks';
import { schaedenDruckAuswahl } from './schaeden/druckAuswahl';
import SchaedenDruckTabelle from './schaeden/SchaedenDruckTabelle';
import { filterSchaeden } from './schaeden/schadenHelfer';

/**
 * Druckansicht der Schadensliste (LFH-727, `openspec/changes/archive/2026-10-01-lfh-727-druck-modul-listen/`
 * design.md D4/D5). Lädt alle nicht stornierten Schäden unter einem eigenen, nicht-live Key (ein
 * Druckbeleg ist ein Schnappschuss) und wählt mit `filterSchaeden` aus, wie die Liste. Typ, Ausmaß
 * und Freitext der `Datensicht` gehen bewusst nicht ein; der Kopf nennt die Auswahl.
 */
export default function SchaedenDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { konventionen } = useAnzeigeKonventionen();
  const [searchParams] = useSearchParams();
  const suche = searchParams.toString();
  const auswahl = useMemo(() => parseSchaedenDruckAuswahl(new URLSearchParams(suche)), [suche]);

  const druckQuery = useQuery({
    queryKey: einsatzKeys.schaedenDruck(einsatzId),
    queryFn: async () => ({
      schaeden: await listeSchaeden(einsatzId),
      geladenAt: new Date().toISOString(),
    }),
    ...DRUCK_ABFRAGE,
  });
  const daten = druckQuery.data;
  // Felder hier lesen, nicht erst im Rahmen (Begründung an `ListenDruckAbfrage`).
  const { isSuccess, isFetching, isError, error, refetch } = druckQuery;
  const ausgewaehlt = useMemo(
    () => (daten ? filterSchaeden(daten.schaeden, auswahl) : []),
    [daten, auswahl],
  );

  return (
    <ListenDruckSeite
      einsatzId={einsatzId}
      modul="Schäden"
      zurueckPfad={schaedenPfad(einsatzId)}
      dokumentart="Schadensliste"
      abfrage={{ isSuccess, isFetching, isError, error, refetch }}
      stand={daten && { geladenAt: daten.geladenAt, anzahl: ausgewaehlt.length }}
      auswahl={schaedenDruckAuswahl(auswahl)}
      umfang={(n) => umfangText(n, 'Schaden', 'Schäden')}
    >
      <SchaedenDruckTabelle schaeden={ausgewaehlt} konventionen={konventionen} />
    </ListenDruckSeite>
  );
}
