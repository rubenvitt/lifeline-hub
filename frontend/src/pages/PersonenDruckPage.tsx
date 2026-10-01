import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladePersonenDruck } from '../api/einsatzPerson';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import ListenDruckSeite from '../druck/ListenDruckSeite';
import { umfangText } from '../druck/umfang';
import { personenDruckAuswahl } from '../personen/druckAuswahl';
import PersonenDruckTabelle from '../personen/PersonenDruckTabelle';
import { filterPersonen } from '../personen/personenFilter';
import { parsePersonenDruckAuswahl, personenPfad } from '../routing/deeplinks';

/**
 * Druckansicht der Betroffenenliste (LFH-727, `openspec/changes/archive/2026-10-01-lfh-727-druck-modul-listen/`
 * design.md D1/D4).
 *
 * Die Daten kommen AUSSCHLIESSLICH über `GET …/personen/druck`: jeder Abruf schreibt serverseitig
 * einen `druck`-Eintrag ins Zugriffsprotokoll. Deshalb kein Retry (jeder Versuch wäre ein
 * Eintrag), nicht live, beim Öffnen immer frisch statt aus dem Cache der Liste oder eines
 * früheren Besuchs, und ohne Verbindung ein Fehler statt des alten Stands (`DRUCK_ABFRAGE`). Die UHS-Namen für den Verbleib gehören zum selben Schnappschuss; fehlen sie
 * (Modul gesperrt, Fehler), steht „UHS" ohne Namen.
 *
 * Gefiltert wird im Client mit derselben Funktion wie die Liste (`filterPersonen`).
 */
export default function PersonenDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { konventionen } = useAnzeigeKonventionen();
  const [searchParams] = useSearchParams();
  const suche = searchParams.toString();
  const auswahl = useMemo(() => parsePersonenDruckAuswahl(new URLSearchParams(suche)), [suche]);

  const druckQuery = useQuery({
    queryKey: einsatzKeys.personenDruck(einsatzId),
    queryFn: async () => {
      const [personen, uhs] = await Promise.all([
        ladePersonenDruck(einsatzId),
        listeUhs(einsatzId).catch(() => []),
      ]);
      return { personen, uhs, geladenAt: new Date().toISOString() };
    },
    ...DRUCK_ABFRAGE,
    // Kein Personen-Schnappschuss im Speicher, wenn die Ansicht verlassen ist.
    gcTime: 0,
  });

  const daten = druckQuery.data;
  // Die Felder HIER lesen, nicht erst im Rahmen: `useQuery` beobachtet nur, was beim Rendern
  // gelesen wird. Der Rahmen liest den Fehler erst nach dem Einsatz — käme der Fehler vorher,
  // rendete die Seite nicht neu und stünde auf „wird geladen".
  const { isSuccess, isFetching, isError, error, refetch } = druckQuery;
  const ausgewaehlt = useMemo(
    () =>
      daten
        ? filterPersonen(daten.personen, {
            ansicht: 'zeilen',
            filter: auswahl.filter,
            nurLuecken: auswahl.nurLuecken,
          })
        : [],
    [daten, auswahl],
  );
  const uhsNamen = useMemo(
    () => new Map((daten?.uhs ?? []).map((u) => [u.id, u.bezeichnung])),
    [daten],
  );

  return (
    <ListenDruckSeite
      einsatzId={einsatzId}
      modul="Betroffene"
      zurueckPfad={personenPfad(einsatzId, {
        filter: auswahl.filter === 'alle' ? undefined : auswahl.filter,
      })}
      dokumentart="Betroffenenliste"
      abfrage={{ isSuccess, isFetching, isError, error, refetch }}
      stand={daten && { geladenAt: daten.geladenAt, anzahl: ausgewaehlt.length }}
      auswahl={personenDruckAuswahl(auswahl)}
      umfang={(n) => umfangText(n, 'Person', 'Personen')}
      hinweis="Das Öffnen dieser Druckansicht wird im Zugriffsprotokoll vermerkt."
    >
      <PersonenDruckTabelle
        personen={ausgewaehlt}
        uhsName={(uhsId) => uhsNamen.get(uhsId)}
        konventionen={konventionen}
      />
    </ListenDruckSeite>
  );
}
