import { IkonePersonPlus } from '../../ikonen';
import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import {
  parseRouteId,
  personenAufnahmePfad,
  unfallhilfsstellenListePfad,
} from '../../routing/deeplinks';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import { Segmentleiste } from '../../components/instrument';
import { uhsStatus, uhsTyp } from '../../theme/statusFarben';
import UhsSwitcher from './UhsSwitcher';
import { merkeLetzteUhs } from './uhsAuswahl';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import BewegungenTab from './BewegungenTab';
import { useFehlerMeldung } from '../../components/useFehlerMeldung';

export default function UhsDetailPage() {
  const { id, uhsId: uhsIdParam } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  // Material/Bewegungen als Segmentleiste; nur das aktive Feld ist gebaut.
  const [reiter, setReiter] = useState<'material' | 'bewegungen'>('material');
  const reiterFeld = useId();
  const { benutzer } = useAuth();
  const uhsId = Number(uhsIdParam);
  const idGueltig = parseRouteId(uhsIdParam) != null;
  const listenPfad = unfallhilfsstellenListePfad(einsatzId);

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

  // Diese UHS als „zuletzt ausgewählt" merken — der Default-Einstieg landet wieder hier.
  useEffect(() => {
    if (detailQuery.isSuccess) merkeLetzteUhs(einsatzId, uhsId);
  }, [einsatzId, uhsId, detailQuery.isSuccess]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = useFehlerMeldung();

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

  // Ungültige UHS-ID → zurück zur Liste (nach allen Hooks).
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

  // Typ und Standort sind Kopf-Meta; der Typ ist eine Kategorie (im Vertrag `neutral`), es zählt
  // nur seine Beschriftung aus `uhsTyp`. Die Notiz ist Freitext und bleibt Beschreibungszeile.
  const meta = [uhsTyp[uhs.typ].label, uhs.standort ?? 'ohne Standort'].join(' · ');

  return (
    <EinsatzSeite
      /* Der Titel trägt den Umschalter: hier wird zwischen Hilfsstellen gewechselt. */
      titel={
        // `wrap`: bei langem Namen rutscht der Status unter den Namen, statt auf 390 px
        // über den Rand zu ragen (gemessen 11 px, LFH-435).
        <Space wrap>
          <UhsSwitcher einsatzId={einsatzId} aktuelleUhs={uhs} />
          <StatusTag darstellung={uhsStatus[uhs.status]} />
        </Space>
      }
      meta={meta}
      beschreibung={uhs.notiz ? `Notiz: ${uhs.notiz}` : undefined}
      /* Datenstand im Kopf über das Primitiv — der Grundriss läuft live mit. */
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
          {/* Die Zustände schließen sich aus; die Dev-Warnung des Primitivs zählt die
              Primäraktionen, der Test prüft beide Zustände. */}
          {!schreibgeschuetzt && uhs.status === 'aktiv' && (
            /* Aufnahme ohne Modulwechsel, nur im Betrieb: eine geplante UHS nimmt niemanden auf,
               dort steht „In Betrieb nehmen" als Primäraktion. */
            <Button
              type="primary"
              icon={<IkonePersonPlus />}
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
        // Mindest-Arbeitsfläche: unter einem langen Kopf scrollt die Seite, statt Grundriss und
        // Reiter zu überlagern. 380 px beschreiben die Fläche, keine Kopfhöhe.
        mindestHoehe: 380,
        inhalt: <Grundriss einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />,
      }}
    >
      {/* Der Seitenkopf teilt die Resthöhe mit dem Grundriss; Material/Bewegungen folgen im
          Seitenfluss. */}
      <Segmentleiste
        rolle="tablist"
        beschriftung="Material und Bewegungen"
        wert={reiter}
        onWechsel={setReiter}
        optionen={[
          { wert: 'material', label: 'Material', steuert: reiterFeld },
          { wert: 'bewegungen', label: 'Bewegungen', steuert: reiterFeld },
        ]}
        style={{ marginTop: 16, marginBottom: 12 }}
      />
      <div
        role="tabpanel"
        id={reiterFeld}
        aria-label={reiter === 'material' ? 'Material' : 'Bewegungen'}
      >
        {reiter === 'material' ? (
          <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
        ) : (
          <BewegungenTab uhs={uhs} dataUpdatedAt={detailQuery.dataUpdatedAt} />
        )}
      </div>
    </EinsatzSeite>
  );
}
