import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography } from 'antd';
import { ladeEinsatz } from '../api/einsaetze';
import { loadPersonDruck, registrierAnzeige } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  istNichtGefunden,
  SeitenFehler,
  SeitenNichtGefunden,
  SeitenSkeleton,
} from '../components/SeitenZustand';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import { modulName } from '../einsatz/modulRegistry';
import PersonDruckBlatt from '../personen/PersonDruckBlatt';
import { parseRouteId, personDetailPfad, personenPfad } from '../routing/deeplinks';
import { useEinsatzPfade } from '../routing/EinsatzPfade';
import { zeitpunkt } from '../anzeige/zeitDarstellung';
import { ListenRueckweg } from '../components/ListenRueckweg';

/**
 * Druckansicht einer Person (LLH-1120, Spec `druck-dokumente`, „Druckansicht einer Person“;
 * Muster Auftragsdruck LLH-1171). Das Detail einer Person führt als Nebenweg hierher, auch ohne
 * Schreibrecht, nie am Gerät (die Gerätehülle kennt die Route nicht, der Server lehnt sie dort
 * ab).
 *
 * Geladen wird nur über `GET …/persons/{pid}/print`: jeder Abruf schreibt einen `druck`-Eintrag
 * mit Person ins Zugriffsprotokoll (`frontend/src/druck/AGENTS.md`, Personendruck). Deshalb die
 * Optionen aus `druck/abfrageOptionen.ts` (kein stiller Retry, offline scheitern) und ein eigener,
 * nicht live geführter Key: das Blatt ist ein Schnappschuss, „Neu laden“ holt den neuen Stand.
 *
 * Eine Person, die es nicht (mehr) gibt (404 oder ungültige Kennung in der Adresse), ersetzt die
 * ganze Druckansicht durch `SeitenNichtGefunden` mit dem Rückweg zur Liste, wie am Detail (LLH-1960):
 * „Zurück zur Person“ führte auf ein Detail, das es auch nicht gibt.
 */
export default function PersonDruckPage() {
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = parseRouteId(personIdParam);
  const navigate = useNavigate();
  const { konventionen } = useAnzeigeKonventionen();
  const pfade = useEinsatzPfade();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const druckQuery = useQuery({
    ...DRUCK_ABFRAGE,
    queryKey: einsatzKeys.personDruck(einsatzId, personId ?? 0),
    queryFn: () => loadPersonDruck(einsatzId, personId!),
    enabled: personId != null,
    gcTime: 0,
  });

  // Nach allen Hooks (Rules-of-Hooks); keine stille Weiterleitung, die Adresse bleibt stehen.
  const nichtGefunden = (
    <SeitenNichtGefunden
      titel="Diese Person gibt es nicht (mehr)"
      rueckweg={{ label: pfade.personenListeLabel, pfad: pfade.personenListe(einsatzId) }}
    />
  );
  if (personId == null) return nichtGefunden;
  if (istNichtGefunden(druckQuery.error)) return nichtGefunden;
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const status = druckQuery.error instanceof ApiError ? druckQuery.error.status : null;
  const isOhneDruck = status === 403;
  const person = druckQuery.data;
  const kennung = person ? registrierAnzeige(person.registrier_nr) : undefined;
  const zurueck = personDetailPfad(einsatzId, personId);

  return (
    <EinsatzSeite
      titel={`Person${kennung ? ` ${kennung}` : ''} – Druckansicht`}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            {
              title: (
                <ListenRueckweg to={personenPfad(einsatzId)}>
                  {modulName('personen')}
                </ListenRueckweg>
              ),
            },
            { title: 'Druckansicht' },
          ]}
        />
      }
      aktionen={
        <>
          <Button
            href={zurueck}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck);
            }}
          >
            Zurück zur Person
          </Button>
          {!isOhneDruck && (
            <Button onClick={() => void druckQuery.refetch()} disabled={druckQuery.isFetching}>
              Neu laden
            </Button>
          )}
          {!isOhneDruck && (
            <DruckKnopf typ="primary" gesperrt={!druckQuery.isSuccess || druckQuery.isFetching} />
          )}
        </>
      }
    >
      {status === 403 ? (
        <Alert
          type="info"
          showIcon
          title="Kein Zugriff auf die Personen"
          description="Modul gesperrt oder Aufbewahrungsfrist abgelaufen"
        />
      ) : druckQuery.isError ? (
        <SeitenFehler
          text="Die Person konnte nicht geladen werden"
          ursache={druckQuery.error}
          laedt={druckQuery.isFetching}
          onWiederholen={() => void druckQuery.refetch()}
        />
      ) : !person || druckQuery.isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          Person wird geladen …
        </Typography.Text>
      ) : (
        <div data-lfh="druckwurzel">
          <Druckkopf
            dokumentart="Person"
            titel={kennung}
            einsatz={einsatz}
            sichtbarkeit="immer"
            ebene={2}
            zeilen={[
              {
                etikett: 'Stand',
                wert: zeitpunkt(new Date(druckQuery.dataUpdatedAt).toISOString(), konventionen),
              },
            ]}
          />
          <PersonDruckBlatt einsatzId={einsatzId} person={person} />
        </div>
      )}
    </EinsatzSeite>
  );
}
