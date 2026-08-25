import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import KatalogTabelle from '../components/KatalogTabelle';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listeFahrzeugStatus, type StatusEingabe,
} from '../api/fahrzeugStatus';
import type { FahrzeugStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import StatusTag from '../components/StatusTag';
import { statusKategorie } from '../theme/statusFarben';


interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  fms_anker?: number;
  sortier: number;
}

export default function StatusKatalogTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz (LFH-332 · B4):
  // seit das Anlegen in der Schnellerfassung sitzt, gibt es kein „offen ohne
  // Datensatz" mehr. Ein zweites `modalOffen` daneben könnte nur noch von diesem
  // hier abweichen.
  const [bearbeite, setBearbeite] = useState<FahrzeugStatus | null>(null);

  const statusQuery = useQuery({ queryKey: globalKeys.fahrzeugStatus(), queryFn: listeFahrzeugStatus });

  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: FormWerte }) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: leerZuNull(werte.farbe),
        fms_anker: werte.fms_anker ?? null,
        sortier: werte.sortier ?? 0,
      };
      return aktualisiereStatus(id, daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeugStatus() });
      setBearbeite(null);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332 · B4, Befund M43). Pflicht ist allein das Label.
   * `kategorie: 'gebunden'` und `sortier: 0` sind keine erfundenen Werte, sondern
   * byte-genau die Vorbelegung, die der gestrichene Anlege-Zweig des Dialogs
   * gesetzt hat (`form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 })`);
   * `farbe: null` und `fms_anker: null` entsprechen den leeren Feldern, die dieser
   * Zweig ebenfalls hinterliess. Kategorie, Farbe, FMS-Anker und Reihenfolge trägt
   * man bei Bedarf im Bearbeiten-Dialog nach.
   *
   * KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung.
   */
  const schnellAnlegen = useMutation({
    mutationFn: (label: string) =>
      legeStatusAn({ label, kategorie: 'gebunden', farbe: null, fms_anker: null, sortier: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.fahrzeugStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.fahrzeugStatus() }),
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
        fms_anker: bearbeite.fms_anker ?? undefined,
        sortier: bearbeite.sortier,
      });
    }
  }, [bearbeite, form]);

  const spalten: TableColumnsType<FahrzeugStatus> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      /**
       * Leitspalte: am Label wird ein Status gesucht, nicht an der DB-Kennung.
       *
       * KEIN `defaultSortOrder` — und hier trägt das mehr Gewicht als in den anderen
       * Katalogen: `sortier` IST die fachliche Reihenfolge dieses Katalogs, sie
       * bestimmt die Anordnung in jeder Statusauswahl, und das Backend liefert
       * `ORDER BY sortier, id` (`src/fahrzeug/status_repo.rs:44`). Sie bleibt die
       * Voreinstellung; die alphabetische Sortierung ist ein Angebot zum Auffinden
       * eines Eintrags und wird vom dritten Kopfklick wieder zurückgenommen.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      /**
       * Die geschlossene Achse dieses Katalogs. Die Filterliste kommt aus
       * {@link statusKategorie} statt aus einer eigenen Aufzählung — derselbe Griff wie
       * beim `Select` im Formular unten. Der Vertrag ist ein exhaustiver
       * `Record<StatusKategorie, …>`, eine neue Enum-Variante taucht damit von selbst
       * im Filter auf, statt still zu fehlen.
       *
       * `String(wert)`, weil antd das Filterargument als `React.Key | boolean`
       * typisiert, nicht als `StatusKategorie`.
       */
      filters: (Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
        text: statusKategorie[k].label,
        value: k,
      })),
      onFilter: (wert, s) => s.kategorie === String(wert),
      render: (k: StatusKategorie) => <StatusTag darstellung={statusKategorie[k]} />,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'FMS-Anker', dataIndex: 'fms_anker', key: 'fms_anker', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: FahrzeugStatus) => (
              <Space size="middle">
                <Button onClick={() => setBearbeite(s)}>
                  Bearbeiten
                </Button>
                <Popconfirm
                  title="Status deaktivieren?"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deaktivieren.mutate(s.id)}
                >
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<FahrzeugStatus>)
      : []),
  ];

  return (
    <AdminPage titel="Fahrzeug-Status">
    {/* KEIN `aktionen`-Slot (LFH-346 · A3): der Anlegen-Weg dieser Sektion ist die
        SchnellAnlegen Schnellerfassungszeile am Inhalt. Ein zweiter Knopf im Kopf wären
        zwei Primäraktionen für dieselbe Sache — und der Dialog, den er öffnete, wäre für
        einen Katalog, der am Stück gepflegt wird, das falsche Werkzeug. */}
      {/* Die Schnellerfassung steht ÜBER der Tabelle — dort, wo bis LFH-332 der Knopf
          „Status anlegen" stand, und bewusst AUSSERHALB der Fehlerweiche darunter: ein
          gescheiterter Abruf der Liste ist kein Grund, die einzige Schreibmöglichkeit
          der Seite verschwinden zu lassen. */}
      {istAdmin && (
        <SchnellAnlegen
          beschriftung="Neuer Fahrzeug-Status"
          platzhalter="z. B. einsatzbereit"
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
          text="Statuskatalog konnte nicht geladen werden"
          ursache={statusQuery.error}
          onWiederholen={() => void statusQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={statusQuery.isLoading}
          dataSource={statusQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Kein Status' }}
          // Der Platzhalter nennt NUR das Label, obwohl die Suche des Primitivs jede Spalte
          // mit Datenbezug liest. Grund: sie greift den Rohwert, und der stimmt hier bei
          // genau einer Spalte nicht mit dem Gezeigten überein — die Kategorie zeigt
          // „verfügbar", der Drahtwert heißt `verfuegbar`. Ein Platzhalter, der „Kategorie"
          // verspräche, ginge bei getippten Umlauten ins Leere. Diese Achse bedient der
          // Spaltenfilter, nicht die Suche.
          suche={{ platzhalter: 'Label' }}
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
                value: k,
                label: statusKategorie[k].label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
          </Form.Item>
          <Form.Item label="FMS-Anker (0–9, optional)" name="fms_anker">
            <InputNumber min={0} max={9} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </AdminPage>
  );
}
