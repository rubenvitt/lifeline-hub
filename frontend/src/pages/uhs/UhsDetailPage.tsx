import { Alert, App, Breadcrumb, Button, Drawer, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { parseRouteId, unfallhilfsstellenListePfad } from '../../routing/deeplinks';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { useUhsStream } from '../../etb/useUhsStream';
import { ApiError } from '../../api/client';
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

type DrawerKey = 'material' | 'bewegungen' | null;

export default function UhsDetailPage() {
  const { id, uhsId: uhsIdParam } = useParams();
  const einsatzId = Number(id);
  const uhsId = Number(uhsIdParam);
  const idGueltig = parseRouteId(uhsIdParam) != null;
  const listenPfad = unfallhilfsstellenListePfad(einsatzId);
  useUhsStream(einsatzId);

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [drawer, setDrawer] = useState<DrawerKey>(null);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: ['einsatz-uhs-detail', einsatzId, uhsId],
    queryFn: () => ladeUhs(einsatzId, uhsId),
    enabled: idGueltig,
  });

  // Diese UHS als „zuletzt ausgewählt" merken — der Default-Einstieg landet beim
  // nächsten Mal wieder hier.
  useEffect(() => {
    if (detailQuery.isSuccess) merkeLetzteUhs(einsatzId, uhsId);
  }, [einsatzId, uhsId, detailQuery.isSuccess]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-uhs-detail', einsatzId, uhsId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
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
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" message="UHS konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const uhs = detailQuery.data;
  const ist_aktiv = einsatz.status === 'aktiv';
  const ist_beobachter = einsatz.meine_rolle === 'beobachter';
  const schreibgeschuetzt = !ist_aktiv || ist_beobachter;

  const meta = [
    `Typ: ${uhs.typ}`,
    `Standort: ${uhs.standort ?? '—'}`,
    ...(uhs.notiz ? [`Notiz: ${uhs.notiz}`] : []),
  ].join('  ·  ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)' }}>
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
          <Button size="small" onClick={() => setDrawer('material')}>Material</Button>
          <Button size="small" onClick={() => setDrawer('bewegungen')}>Bewegungen</Button>
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <Grundriss einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
      </div>

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={640}
        title={drawer === 'material' ? 'Material' : 'Bewegungen'}
        destroyOnHidden
      >
        {drawer === 'material' && (
          <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
        )}
        {drawer === 'bewegungen' && <BewegungenTab uhs={uhs} />}
      </Drawer>
    </div>
  );
}
