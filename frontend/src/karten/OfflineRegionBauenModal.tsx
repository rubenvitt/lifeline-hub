import { App, Button, List, Modal, Spin, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ladeBaubareRegionen, starteRegionBau, type BaubareRegion } from '../api/offlineKarten';

/**
 * Picker für den zentralen Region-Build (LFH-203, B5): stößt beim zentralen karten-service einen
 * Build der gewählten Region an (server-seitig, kein lokaler Download). Die fertige Version
 * erscheint im Download-Katalog erst nach der Server-seitigen Manifest-Cache-TTL (~5 min) —
 * das wird hier kommuniziert, ein client-seitiges Cache-Invalidieren bustet nur React Query.
 */
export default function OfflineRegionBauenModal({
  offen,
  onClose,
}: {
  offen: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();

  const regionenQuery = useQuery({
    queryKey: ['admin-karte', 'baubare-regionen'],
    queryFn: ladeBaubareRegionen,
    enabled: offen,
  });

  const bauenMutation = useMutation({
    mutationFn: (slug: string) => starteRegionBau(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-karte', 'bau-status'] });
      message.success('Bau gestartet — die neue Version erscheint in wenigen Minuten im Katalog');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Bau konnte nicht gestartet werden'),
  });

  const regionen = regionenQuery.data ?? [];
  // Nach `gruppe` gruppieren (Reihenfolge = Katalog-Reihenfolge), analog OfflineDownloadKatalogModal.
  const gruppen = regionen.reduce<Record<string, BaubareRegion[]>>((acc, r) => {
    (acc[r.gruppe] ??= []).push(r);
    return acc;
  }, {});

  const renderItem = (region: BaubareRegion) => (
    <List.Item
      actions={[
        <Button
          key="bauen"
          type="link"
          loading={bauenMutation.isPending && bauenMutation.variables === region.slug}
          disabled={bauenMutation.isPending}
          onClick={() => bauenMutation.mutate(region.slug)}
        >
          Bauen
        </Button>,
      ]}
    >
      <List.Item.Meta title={region.name} description={region.region} />
    </List.Item>
  );

  return (
    <Modal open={offen} title="Region neu bauen" footer={null} onCancel={onClose} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Der zentrale Karten-Dienst baut die gewählte Region serverseitig neu (Planetiler-Extrakt).
        Nach Abschluss erscheint die aktualisierte Version — durch die Server-seitige
        Manifest-Cache-TTL zeitversetzt — automatisch im Download-Katalog.
      </Typography.Paragraph>
      {regionenQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : regionen.length === 0 ? (
        <Typography.Text type="secondary">Keine baubaren Regionen verfügbar</Typography.Text>
      ) : (
        Object.entries(gruppen).map(([gruppe, items]) => (
          <div key={gruppe} style={{ marginBottom: 8 }}>
            <Typography.Title level={5} style={{ marginBottom: 4 }}>
              {gruppe}
            </Typography.Title>
            <List dataSource={items} renderItem={renderItem} />
          </div>
        ))
      )}
    </Modal>
  );
}
