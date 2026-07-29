import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listePersonalStatus, type StatusEingabe,
} from '../api/personalStatus';
import type { PersonalStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import StatusTag from '../components/StatusTag';
import { statusKategorie } from '../theme/statusFarben';


interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  sortier: number;
}

export default function PersonalStatusTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz (LFH-332 · B4):
  // seit das Anlegen in der Schnellerfassung sitzt, gibt es kein „offen ohne
  // Datensatz" mehr. Ein zweites `modalOffen` daneben könnte nur noch von diesem
  // hier abweichen.
  const [bearbeite, setBearbeite] = useState<PersonalStatus | null>(null);

  const statusQuery = useQuery({ queryKey: globalKeys.personalStatus(), queryFn: listePersonalStatus });

  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: FormWerte }) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: leerZuNull(werte.farbe),
        sortier: werte.sortier ?? 0,
      };
      return aktualisiereStatus(id, daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }); setBearbeite(null); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332 · B4, Befund M43). Pflicht ist allein das Label.
   * `kategorie: 'gebunden'` und `sortier: 0` sind keine erfundenen Werte, sondern
   * byte-genau die Vorbelegung, die der gestrichene Anlege-Zweig des Dialogs
   * gesetzt hat (`form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 })`);
   * `farbe: null` entspricht dem leeren Feld, das dieser Zweig ebenfalls
   * hinterliess (`leerZuNull(undefined)`). Kategorie, Farbe und Reihenfolge trägt
   * man bei Bedarf im Bearbeiten-Dialog nach.
   *
   * KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung.
   */
  const schnellAnlegen = useMutation({
    mutationFn: (label: string) =>
      legeStatusAn({ label, kategorie: 'gebunden', farbe: null, sortier: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  // Vorbelegung beim Öffnen — kein Zurücksetzen: `destroyOnHidden` am Dialog wirft
  // die Felder beim Schliessen ohnehin weg.
  useEffect(() => {
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        kategorie: bearbeite.kategorie,
        farbe: bearbeite.farbe ?? undefined,
        sortier: bearbeite.sortier,
      });
    }
  }, [bearbeite, form]);

  const spalten: TableColumnsType<PersonalStatus> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      /**
       * Leitspalte: an ihr sucht ein Mensch den Status. Kein `defaultSortOrder` — die
       * fachliche Reihenfolge ist `sortier` und kommt vom Server
       * (`src/personal/status_repo.rs:42` — `ORDER BY sortier, id`); sie bleibt der
       * Einstieg, das Alphabet ist ein Angebot.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      /**
       * Die Filterwerte kommen aus derselben Quelle wie die Anzeige (`theme/statusFarben`),
       * damit eine neue Kategorie nicht an zwei Stellen nachgetragen werden muss. Der
       * gefilterte Wert ist der DRAHTWERT (`nicht_verfuegbar`), der angezeigte Text sein
       * Label — genau deshalb ist die Kategorie hier ein Filter und steht nicht im
       * Suchplatzhalter: die Freitextsuche des Primitivs liest Rohwerte, „nicht verfügbar"
       * fände dort nichts.
       */
      filters: (Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
        text: statusKategorie[k].label,
        value: k,
      })),
      onFilter: (wert, s) => s.kategorie === wert,
      render: (k: StatusKategorie) => <StatusTag darstellung={statusKategorie[k]} />,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: PersonalStatus) => (
              <Space>
                <Button onClick={() => setBearbeite(s)}>Bearbeiten</Button>
                <Popconfirm title="Status deaktivieren?" onConfirm={() => deaktivieren.mutate(s.id)}>
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<PersonalStatus>)
      : []),
  ];

  return (
    <>
      {/* Die Schnellerfassung steht ÜBER der Tabelle — dort, wo bis LFH-332 der Knopf
          „Status anlegen" stand, und bewusst AUSSERHALB der Fehlerweiche darunter: ein
          gescheiterter Abruf der Liste ist kein Grund, die einzige Schreibmöglichkeit
          der Seite verschwinden zu lassen. */}
      {istAdmin && (
        <SchnellAnlegen
          beschriftung="Neuer Personal-Status"
          platzhalter="z. B. dienstbereit"
          knopfText="Status anlegen"
          onAnlegen={(label) => schnellAnlegen.mutateAsync(label)}
          laeuft={schnellAnlegen.isPending}
        />
      )}
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Kein Status" auch dann einen
          leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {statusQuery.isError ? (
        <SeitenFehler
          text="Personal-Status konnte nicht geladen werden"
          ursache={statusQuery.error}
          onWiederholen={() => void statusQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={statusQuery.isLoading}
          dataSource={statusQuery.data ?? []}
          columns={spalten}
          /**
           * Genannt wird nur das Label — die übrigen Spalten mit Datenbezug tragen zwar zur
           * Suche bei (Kategorie als Drahtwert, Farbe als Hexwert, Sortierung als Zahl), aber
           * nach keinem davon tippt jemand. Die Kategorie hat stattdessen ihren Trichter.
           */
          suche={{ platzhalter: 'Label' }}
          locale={{ emptyText: 'Kein Status' }}
        />
      )}
      {/* Nur noch Bearbeiten (LFH-332 · B4). Angelegt wird über die Zeile oben. */}
      <Modal
        open={bearbeite !== null}
        title="Status bearbeiten"
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
          <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
                value: k, label: statusKategorie[k].label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
