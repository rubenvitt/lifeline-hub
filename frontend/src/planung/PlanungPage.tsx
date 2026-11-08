import { Alert, Button, Flex, Modal, Tabs } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { tagUndUhrzeit } from '../anzeige/zeitDarstellung';
import { ladePlanung, loeschePlanung } from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import AdminPage from '../components/AdminPage';
import { useRollen } from '../components/instrument';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { OffeneBearbeitungProvider } from '../components/offeneBearbeitung';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import {
  parsePlanungReiter,
  einsatzPfad,
  parseRouteId,
  planungenPfad,
  type PlanungReiter,
} from '../routing/deeplinks';
import PlanungHelferListe from './PlanungHelferListe';
import PlanungKopf from './PlanungKopf';
import PlanungPostenListe from './PlanungPostenListe';
import PlanungSchichtplan from './PlanungSchichtplan';
import PlanungUebernahmeDialog from './PlanungUebernahmeDialog';

/**
 * Eine Planung ohne Einsatz (LLH-1586, Spec `vorplanung`): der Kopf wird in der Ansicht
 * bearbeitet, darunter die Reiter „Plan“, „Posten“ und „Helfer“ (Abstimmung 08.11.2026). Der
 * Reiter steht als `?reiter=` in der Adresse, ohne Verlaufsschritt. „Planung löschen“ liegt im
 * Menü des Kopfs und fragt einmal nach. Live kommt die Planung über das Org-Ereignis `planung`.
 * „In Einsatz übernehmen“ (LLH-1587) öffnet den Dialog mit Vorschau; danach ist die Planung
 * schreibgeschützt und nennt oben, wann und in welchen Einsatz sie ging.
 */
export default function PlanungPage() {
  const { planungId: roh } = useParams();
  const planungId = parseRouteId(roh);
  const [params, setParams] = useSearchParams();
  const reiter = parsePlanungReiter(params);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const [loeschenOffen, setLoeschenOffen] = useState(false);
  const [isUebernahmeOpen, setUebernahmeOpen] = useState(false);

  const query = useQuery({
    queryKey: globalKeys.planung(planungId ?? 0),
    queryFn: () => ladePlanung(planungId as number),
    enabled: planungId != null,
  });
  const loeschenMut = useMutation({
    mutationFn: () => loeschePlanung(planungId as number),
    onSuccess: () => {
      setLoeschenOffen(false);
      qc.removeQueries({ queryKey: globalKeys.planung(planungId as number) });
      void qc.invalidateQueries({ queryKey: globalKeys.planungen(), exact: true });
      void navigate(planungenPfad());
    },
  });

  const waehleReiter = (r: string) => {
    const neu = new URLSearchParams(params);
    if (r === 'plan') neu.delete('reiter');
    else neu.set('reiter', r);
    setParams(neu, { replace: true });
  };

  const planung = query.data;
  const pfad = [
    { title: <Link to={planungenPfad()}>Planungen</Link> },
    { title: planung?.kopf.bezeichnung ?? 'Planung' },
  ];

  if (planungId == null || (query.error instanceof ApiError && query.error.status === 404)) {
    return (
      <AdminPage titel="Planung" pfad={pfad}>
        <SeitenLeer titel="Diese Planung gibt es nicht" />
      </AdminPage>
    );
  }
  if (!planung) {
    return (
      <AdminPage titel="Planung" pfad={pfad}>
        {query.isError ? (
          <SeitenFehler
            text="Planung konnte nicht geladen werden"
            ursache={query.error}
            onWiederholen={() => void query.refetch()}
          />
        ) : (
          <SeitenSkeleton />
        )}
      </AdminPage>
    );
  }

  // Übernommen (LLH-1587): nur noch lesen und löschen.
  const uebernahme = planung.kopf.uebernahme;
  const readOnly = uebernahme != null;
  const reiterInhalt: Record<PlanungReiter, ReactNode> = {
    plan: <PlanungSchichtplan planung={planung} readOnly={readOnly} />,
    posten: <PlanungPostenListe planung={planung} readOnly={readOnly} />,
    helfer: <PlanungHelferListe planung={planung} readOnly={readOnly} />,
  };

  return (
    <AdminPage
      titel={planung.kopf.bezeichnung}
      pfad={pfad}
      aktionen={
        <Flex gap={token.marginSM} align="center">
          {!readOnly && (
            <Button type="primary" onClick={() => setUebernahmeOpen(true)}>
              In Einsatz übernehmen
            </Button>
          )}
          <MenueAusloeser<'loeschen'>
            eintraege={[{ key: 'loeschen', label: 'Planung löschen', gefahr: true }]}
            zugaenglicherName={`Aktionen zu ${planung.kopf.bezeichnung}`}
            laeuft={loeschenMut.isPending}
            onWahl={() => {
              loeschenMut.reset();
              setLoeschenOffen(true);
            }}
          />
        </Flex>
      }
    >
      {uebernahme && (
        <Alert
          type="info"
          showIcon
          data-lfh="planung-uebernommen"
          style={{ marginBottom: token.margin }}
          title={
            <>
              Am {tagUndUhrzeit(uebernahme.at, konventionen)} in Einsatz{' '}
              <Link to={einsatzPfad(uebernahme.einsatz_id)}>
                {uebernahme.einsatznummer ?? uebernahme.einsatz_id}
              </Link>{' '}
              übernommen
            </>
          }
          description="Die Planung ist schreibgeschützt; Soll, Ist, Offen und Konflikte stehen auf dem Stand der Übernahme. Löschen geht weiter."
        />
      )}
      {/* Eine offene Bearbeitung je Seite: der Kopf sperrt, solange er offen ist, nichts anderes
          in Dialogen; der Merker schützt vor dem Verlassen mit Ungespeichertem. */}
      <OffeneBearbeitungProvider aktiv>
        <div style={{ marginBottom: token.margin }}>
          <PlanungKopf
            planung={planung}
            readOnly={readOnly}
            onNeuLaden={() => void query.refetch()}
          />
        </div>
        <Tabs
          activeKey={reiter}
          onChange={waehleReiter}
          destroyOnHidden
          items={[
            { key: 'plan', label: 'Plan', children: reiterInhalt.plan },
            {
              key: 'posten',
              label: `Posten · ${planung.posten.length}`,
              children: reiterInhalt.posten,
            },
            {
              key: 'helfer',
              label: `Helfer · ${planung.helfer.length}`,
              children: reiterInhalt.helfer,
            },
          ]}
        />
      </OffeneBearbeitungProvider>
      {isUebernahmeOpen && (
        <PlanungUebernahmeDialog planung={planung} onClose={() => setUebernahmeOpen(false)} />
      )}
      <Modal
        open={loeschenOffen}
        title={`${planung.kopf.bezeichnung} löschen?`}
        okText="Planung löschen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: loeschenMut.isPending }}
        onOk={() => loeschenMut.mutate()}
        onCancel={() => setLoeschenOffen(false)}
        destroyOnHidden
      >
        <p style={{ margin: 0 }}>Posten, Blöcke und Helfer werden mitgelöscht.</p>
        {loeschenMut.error != null && (
          <SpeicherFehler fehler={loeschenMut.error} titel="Planung nicht gelöscht" />
        )}
      </Modal>
    </AdminPage>
  );
}
