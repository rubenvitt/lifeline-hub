import {
  Alert, App, Button, Popconfirm, Progress, Space, Table, Tag, Typography,
  type TableColumnsType,
} from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktiviereOfflineKarte,
  brecheOfflineDownloadAb,
  listeOfflineKarten,
  loescheOfflineKarte,
  starteOfflineDownload,
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

/** Datenstand aus der Quell-URL (datums-stempel YYYYMMDD) → „YYYY-MM-DD", sonst null. */
function standAusUrl(url: string | null | undefined): string | null {
  const m = url?.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

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
  // „Aktualisieren" = neueren Katalog-Stand herunterladen (neue Zeile; danach aktivieren/löschen).
  const aktualisierenMutation = useMutation({
    mutationFn: (k: OfflineKarte) =>
      starteOfflineDownload({
        name: k.name,
        url: k.katalog_url!,
        lizenz: k.lizenz ?? '',
        kachel_schema: k.kachel_schema,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Update-Download gestartet');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktualisieren fehlgeschlagen'),
  });

  const spalten: TableColumnsType<OfflineKarte> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, k: OfflineKarte) => {
        const stand = standAusUrl(k.quell_url);
        return (
          <div>
            <div>{name}</div>
            {(stand || k.update_verfuegbar) && (
              <Space size={6} style={{ marginTop: 2 }}>
                {stand && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Stand {stand}
                  </Typography.Text>
                )}
                {k.update_verfuegbar && (
                  <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                    Update verfügbar
                  </Tag>
                )}
              </Space>
            )}
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: OfflineKarteStatus, k: OfflineKarte) => {
        if (s !== 'laedt') {
          const t = STATUS_TAG[s];
          return <Tag color={t.color}>{t.label}</Tag>;
        }
        // Live-Fortschritt aus dem Backend (geladen/gesamt). Ohne Content-Length (gesamt null)
        // → geladene Bytes statt Prozent.
        const prozent =
          k.geladen != null && k.gesamt ? Math.floor((k.geladen / k.gesamt) * 100) : undefined;
        return (
          <Space size={8}>
            <Tag icon={<LoadingOutlined spin />} color="processing" style={{ marginInlineEnd: 0 }}>
              lädt
            </Tag>
            {prozent != null ? (
              <Progress percent={prozent} size="small" style={{ width: 120, marginBottom: 0 }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatGroesse(k.geladen)}
              </Typography.Text>
            )}
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
                {k.status === 'bereit' && k.update_verfuegbar && k.katalog_url && (
                  <Button size="small" onClick={() => aktualisierenMutation.mutate(k)}>
                    Aktualisieren
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
