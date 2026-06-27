import { App, Button, List, Modal, Spin, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import type { OnlineStyle } from '../api/karte';
import { ladeOnlineQuellenKatalog, legeOnlineQuelleAn, type OnlineQuelleBody } from '../api/onlineQuellen';
import { invalidiereKarte } from './invalidiereKarte';

/**
 * Server-autoritativer Vorschlagskatalog: listet kuratierte Online-Styles, je
 * Eintrag „Hinzufügen" = POST. Bereits (per URL) vorhandene Einträge sind
 * ausgegraut, damit keine Dubletten entstehen. Bleibt offen, damit mehrere
 * Quellen nacheinander übernommen werden können.
 */
export default function AusKatalogModal({
  offen,
  vorhandeneUrls,
  naechsteSortier,
  onClose,
}: {
  offen: boolean;
  vorhandeneUrls: Set<string>;
  naechsteSortier: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();

  const katalogQuery = useQuery({
    queryKey: ['admin-karte', 'katalog'],
    queryFn: ladeOnlineQuellenKatalog,
    enabled: offen,
  });

  const hinzufuegenMutation = useMutation({
    mutationFn: (eintrag: OnlineStyle) => {
      const body: OnlineQuelleBody = {
        name: eintrag.name,
        url: eintrag.url,
        typ: eintrag.typ,
        attribution: eintrag.attribution,
        sortier: naechsteSortier,
        aktiv: true,
        proxy: false, // Katalog-Quellen sind schlüssellos → kein Proxy nötig.
      };
      return legeOnlineQuelleAn(body);
    },
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Quelle übernommen');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Übernehmen fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title="Aus Katalog hinzufügen"
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
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
                    key="add"
                    type="link"
                    disabled={vorhanden || hinzufuegenMutation.isPending}
                    onClick={() => hinzufuegenMutation.mutate(eintrag)}
                  >
                    {vorhanden ? 'Vorhanden' : 'Hinzufügen'}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      {eintrag.name} <Tag>{eintrag.typ}</Tag>
                    </span>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {eintrag.url}
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
