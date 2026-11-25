import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Typography } from 'antd';
import { loadPassListeDruck } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import DruckTabelle from '../druck/DruckTabelle';
import ListenDruckSeite from '../druck/ListenDruckSeite';
import { umfangText } from '../druck/umfang';
import { PASS_SPALTEN, ZWECK_BILDSCHIRM, ZWECK_BLATT } from '../personen/passListe';
import { personenPfad } from '../routing/deeplinks';

/**
 * Druckansicht der PASS-Liste (LLH-1198, Entwurf `2026-11-24-sco62ku3-pass-liste`): die
 * Betroffenen für die Personenauskunftsstelle, nur für die Einsatzleitung.
 *
 * Die Zeilen kommen AUSSCHLIESSLICH über `GET …/persons/print?profile=pass`: jeder Abruf schreibt
 * serverseitig einen `pass_druck`-Eintrag. Deshalb wie die Betroffenenliste kein Retry, nicht live,
 * beim Öffnen immer frisch und ohne Verbindung ein Fehler statt des alten Stands (`DRUCK_ABFRAGE`).
 * Der Server liefert fertige Texte und die Reihenfolge; hier wird nichts zugeordnet oder gefiltert.
 */
export default function PassListeDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);

  const druckQuery = useQuery({
    queryKey: einsatzKeys.passListeDruck(einsatzId),
    queryFn: async () => ({
      zeilen: await loadPassListeDruck(einsatzId),
      geladenAt: new Date().toISOString(),
    }),
    ...DRUCK_ABFRAGE,
    // Keine Personendaten im Speicher, wenn die Ansicht verlassen ist.
    gcTime: 0,
  });
  const daten = druckQuery.data;
  // Felder hier lesen, nicht erst im Rahmen (Begründung in `PersonenDruckPage`).
  const { isSuccess, isFetching, isError, error, refetch } = druckQuery;

  return (
    <ListenDruckSeite
      einsatzId={einsatzId}
      modul="Betroffene"
      zurueckPfad={personenPfad(einsatzId, {})}
      dokumentart="PASS-Liste"
      abfrage={{ isSuccess, isFetching, isError, error, refetch }}
      stand={daten && { geladenAt: daten.geladenAt, anzahl: daten.zeilen.length }}
      auswahl="alle Personen"
      umfang={(n) => umfangText(n, 'Person', 'Personen')}
      hinweis={ZWECK_BILDSCHIRM}
    >
      <Typography.Paragraph data-lfh="pass-zweck" strong>
        {ZWECK_BLATT}
      </Typography.Paragraph>
      <DruckTabelle
        kennung="pass-liste-tabelle"
        spalten={PASS_SPALTEN}
        zeilen={daten?.zeilen ?? []}
        schluessel={(z) => z.id_label}
      />
    </ListenDruckSeite>
  );
}
