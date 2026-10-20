import { Breadcrumb, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeEvakuierung } from '../api/evakuierung';
import { einsatzKeys } from '../api/queryKeys';
import BezirkTabelle from '../betreuung/BezirkTabelle';
import EvakuierungKennzahlen from '../betreuung/EvakuierungKennzahlen';
import { useBezirkHandlungen } from '../betreuung/useBezirkHandlungen';
import { scrolleZurZeile } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';

/**
 * Fachmodul Evakuierung (LLH-1034, bis dahin der obere Block der Betreuungsseite): Räumungsbezirke
 * mit ihrem Stand „evakuiert". Eine Route, keine Detailroute; ein Bezirk wird per `?bezirk=`
 * hervorgehoben (auch aus alten Links `…/betreuung?bezirk=`, die die Betreuungsseite umleitet).
 *
 * Aufbau: Kopf mit genau einer Primäraktion „Evakuierungsbezirk anlegen", darunter das
 * Kennzahlenband der Räumung (entfällt ohne aktiven Bezirk), darunter die Bezirkstabelle mit
 * „Stand melden" je Zeile und dem Verlauf als Aufklappbereich. Handlungen und Dialoge liegen in
 * `useBezirkHandlungen`, damit eine Detailseite eines Bezirks dieselben nutzt.
 *
 * Live: Mutationen und das `evakuierung`-Ereignis invalidieren `einsatzKeys.evakuierung`; dasselbe
 * Fach speist Modulzähler und die Kennzahl „Evakuiert" im Lage-Dashboard.
 */
export default function EvakuierungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const evakuierungQuery = useQuery({
    queryKey: einsatzKeys.evakuierung(einsatzId),
    queryFn: () => ladeEvakuierung(einsatzId),
  });
  const darfSchreiben = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;
  const bezirke = useMemo(() => evakuierungQuery.data?.bezirke ?? [], [evakuierungQuery.data]);

  const handlungen = useBezirkHandlungen({ einsatzId, bezirke, darfSchreiben });

  // Cross-Modul-Deeplink: `?bezirk=` hebt die Zeile hervor.
  useQueryParamSelektion('bezirk', evakuierungQuery.isSuccess, (bid) => {
    if (bezirke.some((b) => b.id === bid)) setHervorgehoben(bid);
  });
  useEffect(() => {
    if (hervorgehoben == null) return;
    scrolleZurZeile(`bezirk-${hervorgehoben}`);
  }, [hervorgehoben]);

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  // Fehler ist nicht leer: ohne Daten tritt der Fehler an die Stelle von Band und Tabelle, mit
  // Daten bleiben sie stehen und bekommen ein Banner.
  const gescheitert = evakuierungQuery.isError && evakuierungQuery.data == null;
  const veraltet = evakuierungQuery.isError && evakuierungQuery.data != null;
  const ladend = evakuierungQuery.isLoading;

  return (
    <EinsatzSeite
      titel={modulName('evakuierung')}
      meta={
        evakuierungQuery.data
          ? `${bezirke.length} ${bezirke.length === 1 ? 'Bezirk' : 'Bezirke'}`
          : undefined
      }
      dataUpdatedAt={evakuierungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('evakuierung') },
          ]}
        />
      }
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={handlungen.oeffneAnlegen}>
          Evakuierungsbezirk anlegen
        </Button>
      }
      neueZeile={darfSchreiben ? handlungen.oeffneAnlegen : undefined}
      hinweis={
        <SeitenHinweise
          rechteFehlt={!darfSchreiben}
          rechteText={einsatzRechteGrund(einsatz.status)}
          fehler={handlungen.ruecknahmeFehler}
          fehlerTitel="Meldung konnte nicht zurückgenommen werden"
        />
      }
    >
      {gescheitert ? (
        <SeitenFehler
          text="Evakuierung konnte nicht geladen werden"
          ursache={evakuierungQuery.error}
          onWiederholen={() => void evakuierungQuery.refetch()}
        />
      ) : (
        <>
          {veraltet && (
            <SeitenStandVeraltet onWiederholen={() => void evakuierungQuery.refetch()} />
          )}
          <EvakuierungKennzahlen bezirke={bezirke} ladend={ladend} />
          <BezirkTabelle
            einsatzId={einsatzId}
            bezirke={bezirke}
            ladend={ladend}
            darfSchreiben={darfSchreiben}
            hervorgehoben={hervorgehoben}
            onStandMelden={handlungen.oeffneStand}
            onAktion={handlungen.bezirkAktion}
          />
        </>
      )}
      {handlungen.dialoge}
    </EinsatzSeite>
  );
}
