import { Alert, App, Button, Popconfirm, Space, Spin, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktiviereOfflineKarte,
  brecheOfflineDownloadAb,
  listeOfflineKarten,
  loescheOfflineKarte,
  type OfflineKarte,
  type OfflineKarteStatus,
} from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';
import { formatGroesse } from './formatGroesse';
import OfflineDownloadKatalogModal from './OfflineDownloadKatalogModal';
import OfflineDownloadUrlModal from './OfflineDownloadUrlModal';

const STATUS_TAG: Record<OfflineKarteStatus, { color: string; label: string }> = {
  registriert: { color: 'default', label: 'registriert' },
  laedt: { color: 'processing', label: 'lädt' },
  bereit: { color: 'green', label: 'bereit' },
  fehler: { color: 'red', label: 'Fehler' },
};

/**
 * Verwaltungstabelle der Offline-Karten (PMTiles) mit In-App-Download-Manager (LFH-181).
 * Lesen für alle Admin-Bereichs-Berechtigten; Schreiben (Download/Aktivieren/Abbrechen/Löschen)
 * nur System-Admin. Solange eine Zeile lädt, pollt die Liste (Status-Polling statt SSE).
 */
export default function OfflineKartenVerwaltung() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [katalogOffen, setKatalogOffen] = useState(false);
  const [urlOffen, setUrlOffen] = useState(false);

  const kartenQuery = useQuery({
    queryKey: ['admin-karte', 'offline-karten'],
    queryFn: listeOfflineKarten,
    // Polling: solange irgendeine Karte lädt, alle 2 s neu laden — sonst aus.
    refetchInterval: (query) =>
      query.state.data?.some((k) => k.status === 'laedt') ? 2000 : false,
  });
  const karten = useMemo(() => kartenQuery.data ?? [], [kartenQuery.data]);
  const vorhandeneUrls = useMemo(
    () => new Set(karten.map((k) => k.quell_url).filter((u): u is string => u != null)),
    [karten],
  );

  const aktivierenMutation = useMutation({
    mutationFn: (id: number) => aktiviereOfflineKarte(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktivieren fehlgeschlagen'),
  });
  const abbrechenMutation = useMutation({
    mutationFn: (id: number) => brecheOfflineDownloadAb(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Abbrechen fehlgeschlagen'),
  });
  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheOfflineKarte(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  const spalten: TableColumnsType<OfflineKarte> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: OfflineKarteStatus) => {
        const t = STATUS_TAG[s];
        return (
          <Space size={4}>
            <Tag color={t.color}>{t.label}</Tag>
            {s === 'laedt' && <Spin size="small" />}
          </Space>
        );
      },
    },
    {
      title: 'Größe',
      dataIndex: 'groesse',
      key: 'groesse',
      render: (g: number | null) => formatGroesse(g),
    },
    {
      title: 'Basemap',
      dataIndex: 'aktiv_basemap',
      key: 'aktiv_basemap',
      render: (a: boolean) => (a ? <Tag color="green">aktiv</Tag> : <Tag>—</Tag>),
    },
    {
      title: 'Attribution',
      dataIndex: 'lizenz',
      key: 'lizenz',
      render: (l: string | null) => l ?? '—',
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, k: OfflineKarte) => (
              <Space>
                {k.status === 'bereit' && !k.aktiv_basemap && (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => aktivierenMutation.mutate(k.id)}
                  >
                    Aktivieren
                  </Button>
                )}
                {k.status === 'laedt' && (
                  <Button size="small" onClick={() => abbrechenMutation.mutate(k.id)}>
                    Abbrechen
                  </Button>
                )}
                {k.status !== 'laedt' && (
                  <Popconfirm
                    title="Offline-Karte löschen?"
                    okText="Löschen"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => loeschenMutation.mutate(k.id)}
                  >
                    <Button size="small" danger>
                      Löschen
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<OfflineKarte>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => setKatalogOffen(true)}>
            Aus Katalog herunterladen
          </Button>
          <Button onClick={() => setUrlOffen(true)}>Per URL herunterladen</Button>
        </Space>
      )}
      {kartenQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Offline-Karten konnten nicht geladen werden"
          description={kartenQuery.error instanceof ApiError ? kartenQuery.error.message : undefined}
        />
      ) : (
        <Table
          rowKey="id"
          loading={kartenQuery.isLoading}
          dataSource={karten}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Offline-Karten' }}
          pagination={false}
        />
      )}
      <OfflineDownloadKatalogModal
        offen={katalogOffen}
        vorhandeneUrls={vorhandeneUrls}
        onClose={() => setKatalogOffen(false)}
      />
      <OfflineDownloadUrlModal offen={urlOffen} onClose={() => setUrlOffen(false)} />
    </>
  );
}
