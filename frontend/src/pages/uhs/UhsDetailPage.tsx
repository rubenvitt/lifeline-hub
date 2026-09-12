import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin, Tabs } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import {
  parseRouteId,
  personenAufnahmePfad,
  unfallhilfsstellenListePfad,
} from '../../routing/deeplinks';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import { uhsStatus, uhsTyp } from '../../theme/statusFarben';
import { flaeche } from '../../theme/tokens';
import UhsSwitcher from './UhsSwitcher';
import { merkeLetzteUhs } from './uhsAuswahl';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import BewegungenTab from './BewegungenTab';

export default function UhsDetailPage() {
  const { id, uhsId: uhsIdParam } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const uhsId = Number(uhsIdParam);
  const idGueltig = parseRouteId(uhsIdParam) != null;
  const listenPfad = unfallhilfsstellenListePfad(einsatzId);
  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId),
    queryFn: () => ladeUhs(einsatzId, uhsId),
    enabled: idGueltig,
  });

  // Diese UHS als „zuletzt ausgewählt" merken — der Default-Einstieg landet beim
  // nächsten Mal wieder hier.
  useEffect(() => {
    if (detailQuery.isSuccess) merkeLetzteUhs(einsatzId, uhsId);
  }, [einsatzId, uhsId, detailQuery.isSuccess]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const statusMut = useMutation({
    mutationFn: (status: UhsStatus) => setzeUhsStatus(einsatzId, uhsId, status),
    onSuccess: () => {
      message.success('Status gewechselt');
      invalidate();
    },
    onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: () => storniereUhs(einsatzId, uhsId),
    onSuccess: () => {
      message.success('UHS storniert');
      invalidate();
    },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige UHS-ID → zurück zur UHS-Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.error || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" title="UHS konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const uhs = detailQuery.data;
  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatz, benutzer);

  const meta = [
    // Der Typ ist eine Kategorie und trägt im Vertrag durchgängig `neutral` — hier zählt
    // nur seine Beschriftung. Die liegt seit LFH-328/A2 im Vertrag (`theme/statusFarben.ts`,
    // `uhsTyp`); `UnfallhilfsstellenPage` und `UhsAnlegenDrawer` lesen bereits von dort,
    // diese Seite ist der dritte Konsument (LFH-341 · M54).
    `Typ: ${uhsTyp[uhs.typ].label}`,
    `Standort: ${uhs.standort ?? '—'}`,
    ...(uhs.notiz ? [`Notiz: ${uhs.notiz}`] : []),
  ].join('  ·  ');

  return (
    <EinsatzSeite
      breite={flaeche.seiteBreit}
      /* Der Titel trägt den Umschalter, nicht bloß den Namen: die UHS-Detailseite ist der
         Ort, an dem zwischen mehreren Hilfsstellen gewechselt wird (LFH-25). */
      titel={
        <Space>
          <UhsSwitcher einsatzId={einsatzId} aktuelleUhs={uhs} />
          <StatusTag darstellung={uhsStatus[uhs.status]} />
        </Space>
      }
      beschreibung={meta}
      /* Betriebs-Feedback im Kopf (B6-Muster): die beiden Reiter tragen es seit B2, die
         Seite selbst nicht — ausgerechnet dort, wo der Grundriss live mitläuft. Das
         Primitiv rendert den Indikator; eine eigene `<Datenstand>`-Zeile daneben wäre die
         zweite Bauform für dieselbe Sache. */
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatz.bezeichnung}</Link> },
            { title: <Link to={listenPfad}>Unfallhilfsstellen</Link> },
            { title: uhs.bezeichnung },
          ]}
        />
      }
      aktionen={
        <Space wrap size="middle">
          {/* Die Zustände schliessen sich aus — aber das ist ab jetzt nicht mehr
              handgezählt: die Dev-Warnung des Primitivs zählt die Primäraktionen in
              diesem Slot, und der Test daneben prüft beide Zustände. */}
          {!schreibgeschuetzt && uhs.status === 'aktiv' && (
            /* Die Aufnahme ohne Modulwechsel (LFH-341 · H38). Nur im Betrieb: eine geplante
               UHS nimmt niemanden auf, und dort steht „In Betrieb nehmen" als Primäraktion.
               Die beiden schliessen sich damit aus — nicht mehr handgezählt, sondern von der
               Dev-Warnung des Seitenkopfs (Task 2) und ihrem Test gedeckt. */
            <Button
              type="primary"
              icon={<UserAddOutlined aria-hidden />}
              onClick={() => navigate(personenAufnahmePfad(einsatzId, { uhs: uhs.id }))}
            >
              Patient aufnehmen
            </Button>
          )}
          {!schreibgeschuetzt && uhs.status === 'geplant' && (
            <>
              <Button
                type="primary"
                onClick={() => statusMut.mutate('aktiv')}
                loading={statusMut.isPending}
              >
                In Betrieb nehmen
              </Button>
              <Popconfirm
                title="UHS stornieren?"
                onConfirm={() => stornoMut.mutate()}
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </>
          )}
          {!schreibgeschuetzt && uhs.status === 'aktiv' && (
            <Popconfirm
              title="UHS auflösen?"
              description="Nur möglich, wenn keine Person mehr belegt ist."
              onConfirm={() => statusMut.mutate('aufgeloest')}
              okButtonProps={{ danger: true }}
            >
              <Button danger>Auflösen</Button>
            </Popconfirm>
          )}
        </Space>
      }
      fensterInhalt={{
        // Die bisherige Mindest-Arbeitsfläche bleibt: unter einem langen Kopf
        // scrollt die Seite weiter, statt Grundriss und Reiter zu überlagern.
        // 380px beschreibt die Fläche, nicht eine geschätzte Kopfhöhe.
        mindestHoehe: 380,
        inhalt: <Grundriss einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />,
      }}
    >
      {/* Der Seitenkopf teilt die echte Resthöhe mit dem Grundriss (LFH-459).
          Material/Bewegungen folgen weiterhin im Seitenfluss (LFH-149). */}
      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'material',
            label: 'Material',
            children: (
              <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
            ),
          },
          {
            key: 'bewegungen',
            label: 'Bewegungen',
            children: <BewegungenTab uhs={uhs} dataUpdatedAt={detailQuery.dataUpdatedAt} />,
          },
        ]}
      />
    </EinsatzSeite>
  );
}
