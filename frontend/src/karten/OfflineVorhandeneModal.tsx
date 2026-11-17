import { App, Button, Input, Modal, Spin, Tag, Typography } from 'antd';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
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
 * Lokaler Import gebauter Region-Packs: listet im karten_dir vorhandene, noch nicht
 * registrierte MBTiles und übernimmt sie ohne Download in die Offline-Verwaltung.
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

  // Eine Ablehnung steht an der Datei, an der übernommen wurde, kein Toast (`frontend/AGENTS.md`,
  // „Rückwege und Fehler“, LFH-1077). Je Dateiname gemerkt, aus den Callbacks der Mutation
  // (`components/useZeilenFehler.ts`); Öffnen und Schließen räumen alle Gründe.
  const zeilen = useZeilenFehler<string>();
  const { leere } = zeilen;
  useEffect(() => leere(), [offen, leere]);

  const importMutation = useMutation({
    mutationFn: (v: VorhandeneKarte) =>
      registriereOfflineKarte({
        name: (namen[v.dateiname] ?? nameAusDatei(v.dateiname)).trim(),
        pfad: v.dateiname,
        // Selbst gebaute Shortbread-Packs sind OSM-abgeleitet → ODbL-Pflichtattribution.
        lizenz: '© OpenStreetMap contributors (ODbL)',
        kachel_schema: 'shortbread',
      }),
    onMutate: (v) => zeilen.beginne(v.dateiname),
    onError: (e, v) => zeilen.melde(v.dateiname, e, 'Übernehmen fehlgeschlagen'),
    onSuccess: () => {
      invalidiereKarte(qc);
      qc.invalidateQueries({ queryKey: globalKeys.adminKarteBereich('offline-vorhandene') });
      message.success('Region übernommen');
    },
  });

  return (
    <Modal
      open={offen}
      title="Gebaute Region übernehmen"
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      {vorhandeneQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Liste
          // Ohne `unterEbene`, die Eintragstitel sind keine Überschriften (LFH-826): der
          // Titel ist ein Eingabefeld, und ein Bedienelement gehört nicht in eine Überschrift.
          dataSource={vorhandeneQuery.data ?? []}
          emptyText="Keine neuen Dateien im Karten-Verzeichnis"
          renderItem={(v) => {
            const grund = zeilen.grund(v.dateiname);
            return (
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
                    /*
                     * Ohne Größen-Prop, obwohl das Feld im Titel einer Listenzeile sitzt und die Zeile wächst: es
                     * ist das Bedienziel der Zeile, und ein auf 30 px festgenageltes Eingabefeld verfehlte den
                     * Handschuh-Betrieb.
                     */
                    <Input
                      style={{ maxWidth: 260 }}
                      value={namen[v.dateiname] ?? nameAusDatei(v.dateiname)}
                      onChange={(e) => setNamen((n) => ({ ...n, [v.dateiname]: e.target.value }))}
                      aria-label={`Name für ${v.dateiname}`}
                    />
                  }
                  description={
                    <>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {v.dateiname} <Tag>{formatGroesse(v.groesse)}</Tag>
                      </Typography.Text>
                      {grund && (
                        <div>
                          <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />
                        </div>
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
