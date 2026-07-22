import { App, Button, Input, Modal, Spin, Tag, Typography } from 'antd';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  listeVorhandeneKarten,
  registriereOfflineKarte,
  type VorhandeneKarte,
} from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';
import { formatGroesse } from './formatGroesse';
import { globalKeys } from '../api/queryKeys';

/** Dateiname → lesbarer Default-Name: `.mbtiles` weg, `osm.`-Präfix + `.YYYY-MM-DD`-Datum weg. */
function nameAusDatei(dateiname: string): string {
  return dateiname
    .replace(/\.mbtiles$/, '')
    .replace(/^osm\./, '')
    .replace(/\.\d{4}-\d{2}-\d{2}$/, '');
}

/**
 * Lokaler Import gebauter Region-Packs (LFH-199): listet im karten_dir vorhandene, noch nicht
 * registrierte MBTiles und übernimmt sie ohne Download/Hosting in die Offline-Verwaltung. Für
 * self-hosted-Betrieb, wenn der Admin eine Region selbst gebaut/hinterlegt hat.
 */
export default function OfflineVorhandeneModal({
  offen,
  onClose,
}: {
  offen: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Editierbare Namen je Datei (Default aus dem Dateinamen abgeleitet).
  const [namen, setNamen] = useState<Record<string, string>>({});

  const vorhandeneQuery = useQuery({
    queryKey: globalKeys.adminKarteBereich('offline-vorhandene'),
    queryFn: listeVorhandeneKarten,
    enabled: offen,
  });

  const importMutation = useMutation({
    mutationFn: (v: VorhandeneKarte) =>
      registriereOfflineKarte({
        name: (namen[v.dateiname] ?? nameAusDatei(v.dateiname)).trim(),
        pfad: v.dateiname,
        // Selbst gebaute Shortbread-Packs sind OSM-abgeleitet → ODbL-Pflichtattribution (offline sichtbar).
        lizenz: '© OpenStreetMap contributors (ODbL)',
        kachel_schema: 'shortbread',
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      qc.invalidateQueries({ queryKey: globalKeys.adminKarteBereich('offline-vorhandene') });
      message.success('Region übernommen');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Übernehmen fehlgeschlagen'),
  });

  return (
    <Modal open={offen} title="Gebaute Region übernehmen" footer={null} onCancel={onClose} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Übernimmt eine bereits im Karten-Verzeichnis liegende MBTiles-Datei (z. B. selbst mit
        karten-build erzeugt) als Offline-Karte — ohne Download/Hosting. Danach aktivierbar.
      </Typography.Paragraph>
      {vorhandeneQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Liste
          dataSource={vorhandeneQuery.data ?? []}
          emptyText="Keine neuen Dateien im Karten-Verzeichnis"
          renderItem={(v) => (
            <ListenEintrag
              actions={[
                <Button
                  key="imp"
                  type="link"
                  disabled={importMutation.isPending}
                  onClick={() => importMutation.mutate(v)}
                >
                  Übernehmen
                </Button>,
              ]}
            >
              <ListenEintragMeta
                title={
                  <Input
                    size="small"
                    style={{ maxWidth: 260 }}
                    value={namen[v.dateiname] ?? nameAusDatei(v.dateiname)}
                    onChange={(e) => setNamen((n) => ({ ...n, [v.dateiname]: e.target.value }))}
                    aria-label={`Name für ${v.dateiname}`}
                  />
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {v.dateiname} <Tag>{formatGroesse(v.groesse)}</Tag>
                  </Typography.Text>
                }
              />
            </ListenEintrag>
          )}
        />
      )}
    </Modal>
  );
}
