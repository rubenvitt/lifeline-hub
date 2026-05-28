import { Alert, App, Button, Descriptions, Drawer, Popconfirm, Space, Spin, Tabs, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import type { UhsStatus } from '../../api/types';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import BewegungenTab from './BewegungenTab';

const STATUS_LABEL: Record<UhsStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

interface Props {
  einsatzId: number;
  uhsId: number;
  schreibgeschuetzt: boolean;
  onClose: () => void;
}

export default function UhsDetailDrawer({ einsatzId, uhsId, schreibgeschuetzt, onClose }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
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
    onSuccess: () => { message.success('UHS storniert'); invalidate(); onClose(); },
    onError: fehler,
  });

  if (detailQuery.isLoading) return <Drawer open onClose={onClose} width={840}><Spin /></Drawer>;
  if (detailQuery.error || !detailQuery.data) {
    return <Drawer open onClose={onClose} width={840}>
      <Alert type="error" message="UHS konnte nicht geladen werden" />
    </Drawer>;
  }
  const uhs = detailQuery.data;

  return (
    <Drawer
      title={<Space>
        <span>{uhs.bezeichnung}</span>
        <Tag color={STATUS_LABEL[uhs.status].color}>{STATUS_LABEL[uhs.status].label}</Tag>
      </Space>}
      open
      onClose={onClose}
      width={840}
      extra={!schreibgeschuetzt && uhs.status === 'geplant' && (
        <Space>
          <Button type="primary" onClick={() => statusMut.mutate('aktiv')} loading={statusMut.isPending}>
            In Betrieb nehmen
          </Button>
          <Popconfirm title="UHS stornieren?" onConfirm={() => stornoMut.mutate()}>
            <Button danger>Stornieren</Button>
          </Popconfirm>
        </Space>
      )}
    >
      <Descriptions size="small" column={2}>
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
      {!schreibgeschuetzt && uhs.status === 'aktiv' && (
        <Space style={{ marginTop: 16 }}>
          <Popconfirm
            title="UHS auflösen?"
            description="Nur möglich, wenn keine Person mehr belegt ist."
            onConfirm={() => statusMut.mutate('aufgeloest')}
          >
            <Button danger>Auflösen</Button>
          </Popconfirm>
        </Space>
      )}
    </Drawer>
  );
}
