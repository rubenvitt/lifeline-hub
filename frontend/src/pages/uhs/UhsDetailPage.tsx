import { Alert, App, Breadcrumb, Button, Descriptions, Popconfirm, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../../api/einsaetze';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { useUhsStream } from '../../etb/useUhsStream';
import { ApiError } from '../../api/client';
import type { UhsStatus } from '../../api/types';
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
  const uhsId = Number(uhsIdParam);
  const listenPfad = `/einsaetze/${einsatzId}/unfallhilfsstellen`;
  useUhsStream(einsatzId);

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: ['einsatz-uhs-detail', einsatzId, uhsId],
    queryFn: () => ladeUhs(einsatzId, uhsId),
  });

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

  return (
    <div style={{ padding: 16 }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatz.bezeichnung}</Link> },
        { title: <Link to={listenPfad}>Unfallhilfsstellen</Link> },
        { title: uhs.bezeichnung },
      ]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>{uhs.bezeichnung}</Typography.Title>
          <Tag color={STATUS_LABEL[uhs.status].color}>{STATUS_LABEL[uhs.status].label}</Tag>
        </Space>
        <Space>
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
          <Link to={listenPfad}><Button>Zurück zur Liste</Button></Link>
        </Space>
      </Space>
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Typ">{uhs.typ}</Descriptions.Item>
        <Descriptions.Item label="Standort">{uhs.standort ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Notiz" span={2}>{uhs.notiz ?? '—'}</Descriptions.Item>
      </Descriptions>
      <Tabs
        defaultActiveKey="grundriss"
        items={[
          { key: 'grundriss', label: 'Grundriss',
            children: <Grundriss einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} /> },
          { key: 'material', label: 'Material',
            children: <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} /> },
          { key: 'bewegungen', label: 'Bewegungen',
            children: <BewegungenTab uhs={uhs} /> },
        ]}
      />
    </div>
  );
}
