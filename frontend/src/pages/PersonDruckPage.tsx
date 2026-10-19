import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography } from 'antd';
import { ladeEinsatz } from '../api/einsaetze';
import { loadPersonDruck, registrierAnzeige } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import { modulName } from '../einsatz/modulRegistry';
import PersonDruckBlatt from '../personen/PersonDruckBlatt';
import { parseRouteId, personDetailPfad, personenPfad } from '../routing/deeplinks';

/**
 * Druckansicht einer Person (LLH-1120, Spec `druck-dokumente`, „Druckansicht einer Person“;
 * Muster Auftragsdruck LLH-1171). Das Detail einer Person führt als Nebenweg hierher, auch ohne
 * Schreibrecht, nie am Gerät (die Gerätehülle kennt die Route nicht, der Server lehnt sie dort
 * ab).
 *
 * Geladen wird nur über `GET …/personen/{pid}/druck`: jeder Abruf schreibt einen `druck`-Eintrag
 * mit Person ins Zugriffsprotokoll (`frontend/src/druck/AGENTS.md`, Personendruck). Deshalb die
 * Optionen aus `druck/abfrageOptionen.ts` (kein stiller Retry, offline scheitern) und ein eigener,
 * nicht live geführter Key: das Blatt ist ein Schnappschuss, „Neu laden“ holt den neuen Stand.
 * Eine unbekannte Person steht als solche da, ohne Druckknopf.
 */
export default function PersonDruckPage() {
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = parseRouteId(personIdParam);
  const navigate = useNavigate();
  const { konventionen } = useAnzeigeKonventionen();

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

  if (personId == null) return <Navigate to={personenPfad(einsatzId)} replace />;
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
  const isOhneDruck = status === 403 || status === 404;
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
            { title: <Link to={personenPfad(einsatzId)}>{modulName('personen')}</Link> },
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
      {status === 404 ? (
        <Alert type="info" showIcon title="Person nicht gefunden" />
      ) : status === 403 ? (
        <Alert
          type="info"
          showIcon
          title="Kein Zugriff auf die Personen"
          description="Modul gesperrt oder Aufbewahrungsfrist abgelaufen"
        />
      ) : druckQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Die Person konnte nicht geladen werden"
          action={<Button onClick={() => void druckQuery.refetch()}>Erneut laden</Button>}
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
                wert: taktischeDtgVoll(
                  new Date(druckQuery.dataUpdatedAt).toISOString(),
                  konventionen,
                ),
              },
            ]}
          />
          <PersonDruckBlatt einsatzId={einsatzId} person={person} />
        </div>
      )}
    </EinsatzSeite>
  );
}
