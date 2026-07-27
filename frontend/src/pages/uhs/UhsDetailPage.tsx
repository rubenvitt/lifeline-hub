import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { Link, Navigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { parseRouteId, unfallhilfsstellenListePfad } from '../../routing/deeplinks';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsStatus } from '../../api/types';
import UhsSwitcher from './UhsSwitcher';
import { merkeLetzteUhs } from './uhsAuswahl';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import BewegungenTab from './BewegungenTab';

const STATUS_LABEL: Record<UhsStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

export default function UhsDetailPage() {
  const { id, uhsId: uhsIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const uhsId = Number(uhsIdParam);
  const idGueltig = parseRouteId(uhsIdParam) != null;
  const listenPfad = unfallhilfsstellenListePfad(einsatzId);
  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
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
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const statusMut = useMutation({
    mutationFn: (status: UhsStatus) => setzeUhsStatus(einsatzId, uhsId, status),
    onSuccess: () => { message.success('Status gewechselt'); invalidate(); },
    onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: () => storniereUhs(einsatzId, uhsId),
    onSuccess: () => { message.success('UHS storniert'); invalidate(); },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige UHS-ID → zurück zur UHS-Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
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
    `Typ: ${uhs.typ}`,
    `Standort: ${uhs.standort ?? '—'}`,
    ...(uhs.notiz ? [`Notiz: ${uhs.notiz}`] : []),
  ].join('  ·  ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatz.bezeichnung}</Link> },
        { title: <Link to={listenPfad}>Unfallhilfsstellen</Link> },
        { title: uhs.bezeichnung },
      ]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <Space>
          <UhsSwitcher einsatzId={einsatzId} aktuelleUhs={uhs} />
          <Tag color={STATUS_LABEL[uhs.status].color}>{STATUS_LABEL[uhs.status].label}</Tag>
        </Space>
        <Space wrap>
          {!schreibgeschuetzt && uhs.status === 'geplant' && (
            <>
              <Button type="primary" onClick={() => statusMut.mutate('aktiv')} loading={statusMut.isPending}>
                In Betrieb nehmen
              </Button>
              <Popconfirm title="UHS stornieren?" onConfirm={() => stornoMut.mutate()}>
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </>
          )}
          {!schreibgeschuetzt && uhs.status === 'aktiv' && (
            <Popconfirm
              title="UHS auflösen?"
              description="Nur möglich, wenn keine Person mehr belegt ist."
              onConfirm={() => statusMut.mutate('aufgeloest')}
            >
              <Button danger>Auflösen</Button>
            </Popconfirm>
          )}
        </Space>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>{meta}</Typography.Text>
      {/* Grundriss bleibt Hauptinhalt mit bemessener Höhe (Grundriss-Root ist height:100%);
          die Seite scrollt, die Material/Bewegungen-Tabs liegen darunter (LFH-149, kein Drawer). */}
      <div style={{ height: 'calc(100vh - 300px)', minHeight: 380 }}>
        <Grundriss einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
      </div>

      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'material',
            label: 'Material',
            children: <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />,
          },
          { key: 'bewegungen', label: 'Bewegungen', children: <BewegungenTab uhs={uhs} /> },
        ]}
      />
    </div>
  );
}
