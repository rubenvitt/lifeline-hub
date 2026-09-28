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
  aktualisiereTyp,
  deaktiviereTyp,
  legeTypAn,
  listeEinheitTypen,
  type TypEingabe,
} from '../api/einheitTypen';
import type { EinheitTyp, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

interface FormWerte {
  label: string;
  soll?: Staerke | null;
  sortier: number;
}

export default function EinheitTypenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz: angelegt wird in der
  // Schnellerfassung, ein „offen ohne Datensatz" gibt es nicht. Ein zweites `modalOffen`
  // könnte nur von diesem abweichen.
  const [bearbeite, setBearbeite] = useState<EinheitTyp | null>(null);

  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });

  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: FormWerte }) => {
      const daten: TypEingabe = {
        label: werte.label.trim(),
        soll_fuehrer: werte.soll?.fuehrer ?? null,
        soll_unterfuehrer: werte.soll?.unterfuehrer ?? null,
        soll_mannschaft: werte.soll?.mannschaft ?? null,
        sortier: werte.sortier ?? 0,
      };
      return aktualisiereTyp(id, daten);
    },
    // Nur invalidieren: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332). Pflicht ist allein das Label. Die Soll-Stärke bleibt leer
   * (`TypEingabe` lässt alle drei Teile `null` zu, die Tabelle zeigt „—"); `sortier: 0` ist die
   * Vorbelegung des Bearbeiten-Dialogs. Beides trägt man bei Bedarf im Dialog nach.
   *
   * KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung.
   */
  const schnellAnlegen = useMutation({
    mutationFn: (label: string) =>
      legeTypAn({
        label,
        soll_fuehrer: null,
        soll_unterfuehrer: null,
        soll_mannschaft: null,
        sortier: 0,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereTyp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  // VORBELEGUNG, kein Zurücksetzen: das Leeren macht `ErfassungsModal` auf allen vier Auswegen
  // selbst. Ein Reset hier wäre doppelt und verdeckte, ob die Hülle ihre Zusicherung einlöst.
  useEffect(() => {
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        soll: bearbeite.soll,
        sortier: bearbeite.sortier,
      });
    }
  }, [bearbeite, form]);

  // Keine Filterspalte: `EinheitTyp` trägt weder Status noch Kategorie, und das Backend liefert
  // nur `WHERE aktiv = 1`. Eine Achse wird nicht erfunden.
  const spalten: TableColumnsType<EinheitTyp> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      // Leitspalte: am Label sucht ein Mensch den Typ. Die Sortierung ist ein ANGEBOT ohne
      // `defaultSortOrder` — voreingestellt bleibt die fachliche Reihenfolge des Backends
      // (`ORDER BY sortier, id`), die die Zug-vor-Gruppe-Ordnung hält.
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    {
      title: 'Soll-Stärke (F/UF/M//Σ)',
      key: 'soll',
      // Mono an der AUFRUFSTELLE, nicht im Primitiv: `StaerkeAnzeige` rendert bewusst ein
      // Fragment, damit zusammengesetzte Textzeilen nicht in mehrere Textknoten zerfallen.
      render: (_, t) => (
        <span style={monoStil(12)}>
          <StaerkeAnzeige wert={t.soll ?? null} />
        </span>
      ),
    },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      render: (n: number) => <span style={monoStil(12)}>{n}</span>,
      // Numerisch vergleichen, nicht über die Zeichenkette: nur so steht 5 vor 40.
      sorter: (a, b) => a.sortier - b.sortier,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, t: EinheitTyp) => (
              <Space size="middle">
                <Button onClick={() => setBearbeite(t)}>Bearbeiten</Button>
                <Popconfirm
                  title="Typ deaktivieren?"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deaktivieren.mutate(t.id)}
                >
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EinheitTyp>)
      : []),
  ];

  return (
    <AdminPage
      titel="Einheitstypen"
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* KEIN `aktionen`-Slot: der Anlegen-Weg ist die Schnellerfassungszeile am Inhalt. Ein zweiter
         Knopf im Kopf wären zwei Primäraktionen für dieselbe Sache. */}
      {/* Die Schnellerfassung steht ÜBER der Tabelle und AUSSERHALB der Fehlerweiche: ein
         gescheiterter Abruf der Liste ist kein Grund, die einzige Schreibmöglichkeit der Seite
         verschwinden zu lassen.
         Der Platzhalter nennt NICHT „Label" — den trägt schon das Suchfeld der Tabelle, und ein
         zweiter Knoten mit demselben Platzhalter machte den Griff darauf mehrdeutig. */}
      {/* Die Zeile steht IMMER, ohne Recht gesperrt: ein fehlender Knopf ist von „diese Seite kann
         das gar nicht" nicht zu unterscheiden. Den Grund nennt der `RechteHinweis` im `hinweis`-Slot. */}
      <SchnellAnlegen
        beschriftung="Neuer Einheitstyp"
        platzhalter="z. B. Zug"
        knopfText="Typ anlegen"
        onAnlegen={(label) => schnellAnlegen.mutateAsync(label)}
        laeuft={schnellAnlegen.isPending}
        gesperrt={!istAdmin}
      />
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Kein
         Einheitstyp" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {typenQuery.isError ? (
        <SeitenFehler
          text="Einheitstypen konnten nicht geladen werden"
          ursache={typenQuery.error}
          onWiederholen={() => void typenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={typenQuery.isLoading}
          dataSource={typenQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Kein Einheitstyp' }}
          // Der Platzhalter nennt das Feld, das man tippt. „Sortierung" fällt über ihren `dataIndex`
          // mit in den Suchkorpus („4" trifft `sortier: 40`) — harmlos, aber kein Grund für den
          // Platzhalter.
          suche={{ platzhalter: 'Label' }}
        />
      )}
      {/* Nur Bearbeiten; angelegt wird über die Zeile oben. Auf der Hülle, damit der Absende-Knopf IM
         `<form>` liegt und Enter absendet. KEIN `serie`: hier wird bearbeitet. */}
      <ErfassungsModal<FormWerte>
        offen={bearbeite !== null}
        titel="Typ bearbeiten"
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
          <Input placeholder="z. B. Zug" />
        </Form.Item>
        <Form.Item label="Soll-Stärke (vollständig oder leer lassen)" name="soll">
          <StaerkeEingabe />
        </Form.Item>
        <Form.Item label="Sortierung" name="sortier">
          <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
        </Form.Item>
      </ErfassungsModal>
    </AdminPage>
  );
}
