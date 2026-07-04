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
        sha256_erwartet: eintrag.sha256 ?? undefined,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Download gestartet');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Download fehlgeschlagen'),
  });

  const eintraege = katalogQuery.data ?? [];
  // Nach `gruppe` gruppieren (Reihenfolge = Katalog-Reihenfolge); ungruppierte unter „Weitere".
  const gruppen = eintraege.reduce<Record<string, OfflineKatalogEintrag[]>>((acc, e) => {
    const g = e.gruppe ?? 'Weitere';
    (acc[g] ??= []).push(e);
    return acc;
  }, {});

  const renderItem = (eintrag: OfflineKatalogEintrag) => {
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
  };

  return (
    <Modal open={offen} title="Region aufs Gerät bringen" footer={null} onCancel={onClose} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Wähle eine Region und lade sie als Offline-Karte (MBTiles) aufs Gerät — danach nutzbar ganz
        ohne Netz. Der Download läuft in der Prep-Phase (mit Netz); die Pflicht-Attribution wird
        offline angezeigt. Quelle: Eigenbau (karten-build, Planetiler-Shortbread).
      </Typography.Paragraph>
      {katalogQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : eintraege.length === 0 ? (
        <Typography.Text type="secondary">Katalog ist leer</Typography.Text>
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
