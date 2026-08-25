import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space,
  type TableColumnsType,
} from 'antd';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenFehler } from '../components/SeitenZustand';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereQualifikation, deaktiviereQualifikation, legeQualifikationAn,
  listeQualifikationen, type QualifikationEingabe,
} from '../api/qualifikationen';
import type { Qualifikation } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

interface FormWerte {
  label: string;
  sortier: number;
}

export default function QualifikationenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz (LFH-332 · B4):
  // seit das Anlegen in der Schnellerfassung sitzt, gibt es kein „offen ohne
  // Datensatz" mehr. Ein zweites `modalOffen` daneben könnte nur noch von diesem
  // hier abweichen.
  const [bearbeite, setBearbeite] = useState<Qualifikation | null>(null);

  const query = useQuery({ queryKey: globalKeys.qualifikationen(), queryFn: listeQualifikationen });

  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: FormWerte }) => {
      const daten: QualifikationEingabe = { label: werte.label.trim(), sortier: werte.sortier ?? 0 };
      return aktualisiereQualifikation(id, daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }); setBearbeite(null); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332 · B4, Befund M43). Pflicht ist an dieser Entität
   * allein das Label; `sortier: 0` ist deshalb kein erfundener Wert, sondern
   * byte-genau die Vorbelegung, die der gestrichene Anlege-Zweig des Dialogs
   * gesetzt hat (`form.setFieldsValue({ sortier: 0 })`). Wer eine Reihenfolge
   * braucht, trägt sie im Bearbeiten-Dialog nach.
   *
   * KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung.
   * Bei 25 Qualifikationen am Stück wären 25 Einblendungen genau die Störung,
   * gegen die dieses Ticket antritt.
   */
  const schnellAnlegen = useMutation({
    mutationFn: (label: string) => legeQualifikationAn({ label, sortier: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereQualifikation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  // Vorbelegung beim Öffnen — kein Zurücksetzen: `destroyOnHidden` am Dialog wirft
  // die Felder beim Schliessen ohnehin weg.
  useEffect(() => {
    if (bearbeite) form.setFieldsValue({ label: bearbeite.label, sortier: bearbeite.sortier });
  }, [bearbeite, form]);

  const spalten: TableColumnsType<Qualifikation> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      /**
       * Leitspalte: an ihr sucht ein Mensch die Qualifikation. Kein `defaultSortOrder` —
       * die fachliche Reihenfolge ist `sortier` und kommt vom Server
       * (`src/personal/qualifikation_repo.rs:55` — `ORDER BY sortier, id`); sie bleibt der
       * Einstieg, das Alphabet ist ein Angebot. Antds dritter Klick auf den Kopf schaltet
       * die Sortierung wieder ab und stellt damit genau diese Reihenfolge her.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, q: Qualifikation) => (
              <Space size="middle">
                <Button onClick={() => setBearbeite(q)}>Bearbeiten</Button>
                <Popconfirm
                  title="Qualifikation deaktivieren?"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deaktivieren.mutate(q.id)}
                >
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<Qualifikation>)
      : []),
  ];

  return (
    <AdminPage
      titel="Qualifikationen"
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
    {/* KEIN `aktionen`-Slot (LFH-346 · A3): der Anlegen-Weg dieser Sektion ist die
        SchnellAnlegen Schnellerfassungszeile am Inhalt. Ein zweiter Knopf im Kopf wären
        zwei Primäraktionen für dieselbe Sache — und der Dialog, den er öffnete, wäre für
        einen Katalog, der am Stück gepflegt wird, das falsche Werkzeug. */}
      {/* Die Schnellerfassung steht ÜBER der Tabelle — dort, wo bis LFH-332 der
          Knopf „Qualifikation anlegen" stand, und bewusst AUSSERHALB der
          Fehlerweiche darunter: ein gescheiterter Abruf der Liste ist kein Grund,
          die einzige Schreibmöglichkeit der Seite verschwinden zu lassen. */}
      {istAdmin && (
        <SchnellAnlegen
          beschriftung="Neue Qualifikation"
          platzhalter="z. B. Sanitäter"
          knopfText="Qualifikation anlegen"
          onAnlegen={(label) => schnellAnlegen.mutateAsync(label)}
          laeuft={schnellAnlegen.isPending}
        />
      )}
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Keine Qualifikationen" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {query.isError ? (
        <SeitenFehler
          text="Qualifikationen konnten nicht geladen werden"
          ursache={query.error}
          onWiederholen={() => void query.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data ?? []}
          columns={spalten}
          /**
           * Kein Filter in dieser Tabelle, und das ist kein Versäumnis: der Katalog hat weder
           * Status noch Kategorie, und die einzige Zustandsspalte `aktiv` siebt schon der
           * Server aus (`src/personal/qualifikation_repo.rs:55` — `WHERE … aktiv = 1`).
           * Ein Trichter über zwei Spalten, von denen eine eine Zahl ist, wäre Zierrat.
           */
          suche={{ platzhalter: 'Label' }}
          locale={{ emptyText: 'Keine Qualifikationen' }}
        />
      )}
      {/* Nur noch Bearbeiten (LFH-332 · B4). Angelegt wird über die Zeile oben;
          ein Dialog, der sich nach jedem Speichern schliesst, ist für 25 Einträge
          am Stück das falsche Werkzeug. */}
      <Modal
        open={bearbeite !== null}
        title="Qualifikation bearbeiten"
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setBearbeite(null)}
        destroyOnHidden
      >
        <Form<FormWerte>
          form={form}
          layout="vertical"
          onFinish={(w) => { if (bearbeite) speichern.mutate({ id: bearbeite.id, werte: w }); }}
        >
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </AdminPage>
  );
}
