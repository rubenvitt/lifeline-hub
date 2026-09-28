import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  type TableColumnsType,
} from 'antd';
import AdminPage from '../components/AdminPage';
import { monoStil } from '../components/instrument';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus,
  deaktiviereStatus,
  legeStatusAn,
  listePersonalStatus,
  type StatusEingabe,
} from '../api/personalStatus';
import type { PersonalStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
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
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz: angelegt wird in der
  // Schnellerfassung, ein „offen ohne Datensatz" gibt es nicht. Ein zweites `modalOffen`
  // könnte nur von diesem abweichen.
  const [bearbeite, setBearbeite] = useState<PersonalStatus | null>(null);

  const statusQuery = useQuery({
    queryKey: globalKeys.personalStatus(),
    queryFn: listePersonalStatus,
  });

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
    // Nur noch invalidieren: das Schliessen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332). Pflicht ist allein das Label; `kategorie: 'gebunden'`,
   * `sortier: 0` und `farbe: null` sind die Vorbelegung des Bearbeiten-Dialogs, keine
   * erfundenen Werte. Den Rest trägt man bei Bedarf im Dialog nach.
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
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  // VORBELEGUNG, kein Zurücksetzen: das Leeren macht `ErfassungsModal` auf allen vier Auswegen
  // selbst. Ein Reset hier wäre doppelt und verdeckte, ob die Hülle ihre Zusicherung einlöst.
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
       * Leitspalte: an ihr sucht ein Mensch den Status. Kein `defaultSortOrder` — die fachliche
       * Reihenfolge ist `sortier` und kommt vom Server (`ORDER BY sortier, id`); sie bleibt der
       * Einstieg, das Alphabet ist ein Angebot.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      /**
       * Die Filterwerte kommen aus derselben Quelle wie die Anzeige (`theme/statusFarben`). Der
       * gefilterte Wert ist der DRAHTWERT (`nicht_verfuegbar`), der angezeigte sein Label — deshalb
       * ist die Kategorie ein Filter und steht nicht im Suchplatzhalter: die Freitextsuche liest
       * Rohwerte, „nicht verfügbar" fände dort nichts.
       */
      filters: (Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
        text: statusKategorie[k].label,
        value: k,
      })),
      onFilter: (wert, s) => s.kategorie === wert,
      render: (k: StatusKategorie) => <StatusTag darstellung={statusKategorie[k]} />,
    },
    {
      title: 'Farbe',
      dataIndex: 'farbe',
      key: 'farbe',
      // Der gepflegte Code als Wert (Mono), keine Farbfläche: `status_farbe` ist ungeprüfter
      // Freitext, sein Kontrast ist nicht zugesichert (siehe `StatusTag`, Mandantenfarbe).
      render: (f: string | null) => (f ? <span style={monoStil(12)}>{f}</span> : '—'),
    },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      render: (n: number) => <span style={monoStil(12)}>{n}</span>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: PersonalStatus) => (
              <Space size="middle">
                <Button onClick={() => setBearbeite(s)}>Bearbeiten</Button>
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
        ] as TableColumnsType<PersonalStatus>)
      : []),
  ];

  return (
    <AdminPage
      titel="Personal-Status"
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* KEIN `aktionen`-Slot: der Anlegen-Weg ist die Schnellerfassungszeile am Inhalt. Ein zweiter
         Knopf im Kopf wären zwei Primäraktionen für dieselbe Sache. */}
      {/* Die Schnellerfassung steht ÜBER der Tabelle und AUSSERHALB der Fehlerweiche: ein
         gescheiterter Abruf der Liste ist kein Grund, die einzige Schreibmöglichkeit der Seite
         verschwinden zu lassen. */}
      {/* Die Zeile steht IMMER, ohne Recht gesperrt: ein fehlender Knopf ist von „diese Seite kann
         das gar nicht" nicht zu unterscheiden. Den Grund nennt der `RechteHinweis` im `hinweis`-Slot. */}
      <SchnellAnlegen
        beschriftung="Neuer Personal-Status"
        platzhalter="z. B. dienstbereit"
        knopfText="Status anlegen"
        onAnlegen={(label) => schnellAnlegen.mutateAsync(label)}
        laeuft={schnellAnlegen.isPending}
        gesperrt={!istAdmin}
      />
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Kein
         Status" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
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
      {/* Nur Bearbeiten; angelegt wird über die Zeile oben. Auf der Hülle, damit der Absende-Knopf IM
         `<form>` liegt und Enter absendet. KEIN `serie`: hier wird bearbeitet. */}
      <ErfassungsModal<FormWerte>
        offen={bearbeite !== null}
        titel="Status bearbeiten"
        form={form}
        erfassenText="Speichern"
        laeuft={speichern.isPending}
        // `mutateAsync`, nicht `mutate`: bei Ablehnung MUSS die Zusage brechen, sonst leert die Hülle
        // die Felder, obwohl der Datensatz nie ankam. Ein stilles `return` im Leerfall läse sich als
        // Erfolg und schlösse den Dialog ohne Request.
        onErfassen={async (w) => {
          if (!bearbeite) throw new Error('Kein Datensatz zum Bearbeiten');
          await speichern.mutateAsync({ id: bearbeite.id, werte: w });
        }}
        onFertig={() => setBearbeite(null)}
        onAbbrechen={() => setBearbeite(null)}
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
        <Form.Item label="Sortierung" name="sortier">
          <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
        </Form.Item>
      </ErfassungsModal>
    </AdminPage>
  );
}
