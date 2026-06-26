import { App, Button, List, Modal, Spin, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  ladeOfflineKatalog,
  starteOfflineDownload,
  type OfflineKatalogEintrag,
} from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';
import { formatGroesse } from './formatGroesse';

/**
 * Kuratierter Download-Katalog (Server-autoritativ): je Eintrag „Herunterladen" = startet einen
 * Hintergrund-Download. Bereits per Quell-URL geladene/ladende Einträge sind ausgegraut
 * (keine Dubletten). Bleibt offen, damit mehrere Regionen nacheinander geladen werden können.
 */
export default function OfflineDownloadKatalogModal({
  offen,
  vorhandeneUrls,
  onClose,
}: {
  offen: boolean;
  vorhandeneUrls: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();

  const katalogQuery = useQuery({
    queryKey: ['admin-karte', 'offline-katalog'],
    queryFn: ladeOfflineKatalog,
    enabled: offen,
  });

  const downloadMutation = useMutation({
    mutationFn: (eintrag: OfflineKatalogEintrag) =>
      starteOfflineDownload({
        name: eintrag.name,
        url: eintrag.url,
        lizenz: eintrag.lizenz,
        kachel_schema: eintrag.kachel_schema,
        groesse_erwartet: eintrag.groesse,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Download gestartet');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Download fehlgeschlagen'),
  });

  return (
    <Modal open={offen} title="Aus Katalog herunterladen" footer={null} onCancel={onClose} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Lädt eine Offline-Karte (PMTiles) in der Prep-Phase herunter. Quelle: Community-Repo
        (Project N.O.M.A.D.). Pflicht-Attribution wird offline angezeigt.
      </Typography.Paragraph>
      {katalogQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <List
          dataSource={katalogQuery.data ?? []}
          locale={{ emptyText: 'Katalog ist leer' }}
          renderItem={(eintrag) => {
            const vorhanden = vorhandeneUrls.has(eintrag.url);
            return (
              <List.Item
                actions={[
                  <Button
                    key="dl"
                    type="link"
                    disabled={vorhanden || downloadMutation.isPending}
                    onClick={() => downloadMutation.mutate(eintrag)}
                  >
                    {vorhanden ? 'Vorhanden' : 'Herunterladen'}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      {eintrag.name} <Tag>{formatGroesse(eintrag.groesse)}</Tag>
                    </span>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {eintrag.region} · {eintrag.lizenz}
                    </Typography.Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Modal>
  );
}
