import { Alert, App, Button, Modal, Spin, Tag, Typography } from 'antd';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fehlerText } from '../api/client';
import type { OnlineStyle } from '../api/karte';
import {
  ladeOnlineQuellenKatalog,
  legeOnlineQuelleAn,
  type OnlineQuelleBody,
} from '../api/onlineQuellen';
import { invalidiereKarte } from './invalidiereKarte';
import { globalKeys } from '../api/queryKeys';

/**
 * Server-autoritativer Vorschlagskatalog: je Eintrag „Hinzufügen" = POST. Bereits (per URL)
 * vorhandene Einträge sind ausgegraut, damit keine Dubletten entstehen. Bleibt offen für
 * mehrere Übernahmen nacheinander.
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
    queryKey: globalKeys.adminKarteBereich('katalog'),
    queryFn: ladeOnlineQuellenKatalog,
    enabled: offen,
  });

  const hinzufuegenMutation = useMutation({
    mutationFn: (eintrag: OnlineStyle) => {
      const body: OnlineQuelleBody = {
        name: eintrag.name,
        url: eintrag.url,
        typ: eintrag.typ,
        // `OnlineStyle.attribution` ist `?: string | null` (absent statt null); der Eingabe-Body kennt
        // nur `string | null`.
        attribution: eintrag.attribution ?? null,
        sortier: naechsteSortier,
        // Ein Eintrag mit Betreiberhinweis (Esri, Lizenzauflage) kommt INAKTIV an — sonst wäre er mit
        // einem Klick die Grundlage aller, und der Hinweis stünde umsonst da.
        aktiv: !eintrag.hinweis,
        // Katalog-Quellen serverseitig proxen und cachen; ein Schlüssel bleibt so auf dem Server. Ob
        // der Cache bei Esri erlaubt ist, sagt der Hinweis am Eintrag.
        proxy: true,
      };
      return legeOnlineQuelleAn(body);
    },
    onSuccess: (_, eintrag) => {
      invalidiereKarte(qc);
      message.success(
        eintrag.hinweis ? 'Quelle übernommen — inaktiv, bitte Hinweis prüfen' : 'Quelle übernommen',
      );
    },
    onError: (e) => message.error(fehlerText(e, 'Übernehmen fehlgeschlagen')),
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
        <Liste
          // Ohne `unterEbene`, die Eintragstitel sind keine Überschriften (LFH-826): eine
          // Auswahlliste („welche Quelle?“), keine eigenen Gegenstände mit Inhalt darunter.
          dataSource={katalogQuery.data ?? []}
          emptyText="Katalog ist leer"
          renderItem={(eintrag) => {
            const vorhanden = vorhandeneUrls.has(eintrag.url);
            return (
              <ListenEintrag
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
                <ListenEintragMeta
                  title={
                    <span>
                      {eintrag.name} <Tag>{eintrag.typ}</Tag>
                    </span>
                  }
                  description={
                    <>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {eintrag.url}
                      </Typography.Text>
                      {eintrag.hinweis && (
                        <Alert
                          type="warning"
                          showIcon
                          title={eintrag.hinweis}
                          style={{ marginTop: 8 }}
                        />
                      )}
                    </>
                  }
                />
              </ListenEintrag>
            );
          }}
        />
      )}
    </Modal>
  );
}
