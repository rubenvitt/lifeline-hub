import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography } from 'antd';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeAuftrag } from '../api/auftraege';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import AuftragDruckBlatt from '../auftraege/AuftragDruckBlatt';
import { auftragKennung } from '../auftraege/AuftragTeile';
import { modulName } from '../einsatz/modulRegistry';
import { auftraegePfad, parseRouteId } from '../routing/deeplinks';
import { zeitpunkt } from '../anzeige/zeitDarstellung';

/**
 * Druckansicht eines Einzelauftrags (LLH-1171, Spec `druck-dokumente`, Change
 * `ianaw5k1-auftrag-drucken` D1–D3). Das Detail eines Auftrags führt hierher, wie das Detail eines
 * Befehls auf dessen Vollseite; gedruckt wird nur hier, nie aus dem Detailpaneel.
 *
 * Schnappschuss: `einsatzKeys.auftragDruck` ist nicht live (`NICHT_LIVE_KEYS`). Eine Quittung an
 * einem anderen Gerät ändert das offene Blatt nicht; „Neu laden“ holt den neuen Stand. „Drucken“
 * ist gesperrt, bis der Auftrag da ist. Nicht gefunden (404) und kein Zugriff (403) stehen als
 * solche da, ohne Druckknopf.
 */
export default function AuftragDruckPage() {
  const { id, auftragId: auftragIdParam } = useParams();
  const einsatzId = Number(id);
  const auftragId = parseRouteId(auftragIdParam);
  const navigate = useNavigate();
  const { konventionen } = useAnzeigeKonventionen();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const druckQuery = useQuery({
    queryKey: einsatzKeys.auftragDruck(einsatzId, auftragId ?? 0),
    queryFn: () => ladeAuftrag(einsatzId, auftragId!),
    enabled: auftragId != null,
    // Ein Druckbeleg ist ein Schnappschuss: kein stilles Nachladen einer offenen Ansicht, beim
    // Öffnen aber der Stand von jetzt (Begründung in `EtbDruckPage`).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    retry: false,
  });

  if (auftragId == null) return <Navigate to={auftraegePfad(einsatzId)} replace />;
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
  const auftrag = druckQuery.data;
  const modul = modulName('auftraege');
  const zurueck = auftraegePfad(einsatzId, { auftrag: auftragId });
  const kennung = auftrag ? auftragKennung(auftrag) : undefined;

  return (
    <EinsatzSeite
      titel={`Auftrag${kennung ? ` ${kennung}` : ''} – Druckansicht`}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>{modul}</Link> },
            { title: 'Druckansicht' },
          ]}
        />
      }
      aktionen={
        <>
          <Button
            href={zurueck}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck);
            }}
          >
            {`Zurück zu ${modul}`}
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
        <Alert type="info" showIcon title="Auftrag nicht gefunden" />
      ) : status === 403 ? (
        <Alert
          type="info"
          showIcon
          title="Kein Zugriff auf die Aufträge"
          description="Modul gesperrt oder Aufbewahrungsfrist abgelaufen"
        />
      ) : druckQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Der Auftrag konnte nicht geladen werden"
          action={<Button onClick={() => void druckQuery.refetch()}>Erneut laden</Button>}
        />
      ) : !auftrag || druckQuery.isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          Auftrag wird geladen …
        </Typography.Text>
      ) : (
        <div data-lfh="druckwurzel">
          <Druckkopf
            dokumentart="Auftrag"
            titel={kennung}
            einsatz={einsatz}
            sichtbarkeit="immer"
            // Am Bildschirm steht darüber der Seitenkopf mit dem `h1`.
            ebene={2}
            zeilen={[
              {
                etikett: 'Stand',
                wert: zeitpunkt(new Date(druckQuery.dataUpdatedAt).toISOString(), konventionen),
              },
            ]}
          />
          <AuftragDruckBlatt auftrag={auftrag} />
        </div>
      )}
    </EinsatzSeite>
  );
}
