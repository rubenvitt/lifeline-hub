import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeTiere } from '../api/einsatzTier';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import ListenDruckSeite from '../druck/ListenDruckSeite';
import { umfangText } from '../druck/umfang';
import { parseTiereDruckAuswahl, tierePfad } from '../routing/deeplinks';
import { tiereDruckAuswahl } from './tiere/druckAuswahl';
import TiereDruckTabelle from './tiere/TiereDruckTabelle';
import { filterTiere } from './tiere/tierHelfer';

/**
 * Druckansicht der Tierliste (LFH-727, `openspec/changes/archive/2026-10-01-lfh-727-druck-modul-listen/` design.md
 * D4/D5). Lädt die ganze Liste ohne Serverfilter unter einem eigenen, nicht-live Key (ein
 * Druckbeleg ist ein Schnappschuss) und wählt mit `filterTiere` aus, wie die Liste. Ohne Protokoll:
 * Tiere sind keine besondere Kategorie, wie beim Tier-CSV.
 */
export default function TiereDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { konventionen } = useAnzeigeKonventionen();
  const [searchParams] = useSearchParams();
  const suche = searchParams.toString();
  const auswahl = useMemo(() => parseTiereDruckAuswahl(new URLSearchParams(suche)), [suche]);

  const druckQuery = useQuery({
    queryKey: einsatzKeys.tiereDruck(einsatzId),
    queryFn: async () => ({
      tiere: await listeTiere(einsatzId),
      geladenAt: new Date().toISOString(),
    }),
    ...DRUCK_ABFRAGE,
  });
  const daten = druckQuery.data;
  // Felder hier lesen, nicht erst im Rahmen (Begründung an `ListenDruckAbfrage`).
  const { isSuccess, isFetching, isError, error, refetch } = druckQuery;
  const ausgewaehlt = useMemo(
    () => (daten ? filterTiere(daten.tiere, auswahl) : []),
    [daten, auswahl],
  );

  return (
    <ListenDruckSeite
      einsatzId={einsatzId}
      modul="Tiere"
      zurueckPfad={tierePfad(einsatzId)}
      dokumentart="Tierliste"
      abfrage={{ isSuccess, isFetching, isError, error, refetch }}
      stand={daten && { geladenAt: daten.geladenAt, anzahl: ausgewaehlt.length }}
      auswahl={tiereDruckAuswahl(auswahl)}
      umfang={(n) => umfangText(n, 'Tier', 'Tiere')}
    >
      <TiereDruckTabelle tiere={ausgewaehlt} konventionen={konventionen} />
    </ListenDruckSeite>
  );
}
