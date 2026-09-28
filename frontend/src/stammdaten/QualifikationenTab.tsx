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
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereQualifikation,
  deaktiviereQualifikation,
  legeQualifikationAn,
  listeQualifikationen,
  type QualifikationEingabe,
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
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz: angelegt wird in der
  // Schnellerfassung, ein „offen ohne Datensatz" gibt es nicht. Ein zweites `modalOffen`
  // könnte nur von diesem abweichen.
  const [bearbeite, setBearbeite] = useState<Qualifikation | null>(null);

  const query = useQuery({ queryKey: globalKeys.qualifikationen(), queryFn: listeQualifikationen });

  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: FormWerte }) => {
      const daten: QualifikationEingabe = {
        label: werte.label.trim(),
        sortier: werte.sortier ?? 0,
      };
      return aktualisiereQualifikation(id, daten);
    },
    // Nur invalidieren: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332). Pflicht ist allein das Label; `sortier: 0` ist die Vorbelegung
   * des Bearbeiten-Dialogs, kein erfundener Wert. Eine Reihenfolge trägt man im Dialog nach.
   *
   * KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung. Bei 25 Einträgen
   * am Stück wären 25 Einblendungen genau die Störung, die vermieden werden soll.
   */
  const schnellAnlegen = useMutation({
    mutationFn: (label: string) => legeQualifikationAn({ label, sortier: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereQualifikation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }),
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  // VORBELEGUNG, kein Zurücksetzen: das Leeren macht `ErfassungsModal` auf allen vier Auswegen
  // selbst. Ein Reset hier wäre doppelt und verdeckte, ob die Hülle ihre Zusicherung einlöst.
  useEffect(() => {
    if (bearbeite) form.setFieldsValue({ label: bearbeite.label, sortier: bearbeite.sortier });
  }, [bearbeite, form]);

  const spalten: TableColumnsType<Qualifikation> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      /**
       * Leitspalte: an ihr sucht ein Mensch die Qualifikation. Kein `defaultSortOrder` — die
       * fachliche Reihenfolge ist `sortier` (`ORDER BY sortier, id`); sie bleibt der Einstieg, das
       * Alphabet ist ein Angebot. Antds dritter Kopfklick stellt sie wieder her.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
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
      {/* KEIN `aktionen`-Slot: der Anlegen-Weg ist die Schnellerfassungszeile am Inhalt. Ein zweiter
         Knopf im Kopf wären zwei Primäraktionen für dieselbe Sache. */}
      {/* Die Schnellerfassung steht ÜBER der Tabelle und AUSSERHALB der Fehlerweiche: ein
         gescheiterter Abruf der Liste ist kein Grund, die einzige Schreibmöglichkeit der Seite
         verschwinden zu lassen. */}
      {/* Die Zeile steht IMMER, ohne Recht gesperrt: ein fehlender Knopf ist von „diese Seite kann
         das gar nicht" nicht zu unterscheiden. Den Grund nennt der `RechteHinweis` im `hinweis`-Slot. */}
      <SchnellAnlegen
        beschriftung="Neue Qualifikation"
        platzhalter="z. B. Sanitäter"
        knopfText="Qualifikation anlegen"
        onAnlegen={(label) => schnellAnlegen.mutateAsync(label)}
        laeuft={schnellAnlegen.isPending}
        gesperrt={!istAdmin}
      />
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Keine
         Qualifikationen" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
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
           * Kein Filter, und das ist kein Versäumnis: der Katalog hat weder Status noch Kategorie, und
           * `aktiv` siebt schon der Server (`WHERE … aktiv = 1`).
           */
          suche={{ platzhalter: 'Label' }}
          locale={{ emptyText: 'Keine Qualifikationen' }}
        />
      )}
      {/* Nur Bearbeiten; angelegt wird über die Zeile oben. Auf der Hülle, damit der Absende-Knopf IM
         `<form>` liegt und Enter absendet. KEIN `serie`: hier wird bearbeitet. */}
      <ErfassungsModal<FormWerte>
        offen={bearbeite !== null}
        titel="Qualifikation bearbeiten"
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
        <Form.Item label="Sortierung" name="sortier">
          <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
        </Form.Item>
      </ErfassungsModal>
    </AdminPage>
  );
}
