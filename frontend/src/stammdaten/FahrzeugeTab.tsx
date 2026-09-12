import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import { Link } from 'react-router';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladeFahrzeugVorschlaege, listeFahrzeuge, setzeDienststatus } from '../api/fahrzeuge';
import type { Fahrzeug } from '../api/types';
import FahrzeugFormModal from './FahrzeugFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { fahrzeugDetailPfad } from './stammdatenDetail';

function staerkeText(f: Fahrzeug): string {
  if (!f.staerke) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = f.staerke;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`;
}

export default function FahrzeugeTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Fahrzeug | null>(null);

  const fahrzeugeQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('alle'),
    queryFn: () => listeFahrzeuge(false),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.fahrzeugVorschlaege(),
    queryFn: ladeFahrzeugVorschlaege,
  });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Fahrzeug> = [
    {
      title: 'Funkrufname',
      dataIndex: 'funkrufname',
      key: 'funkrufname',
      /**
       * Leitspalte: am Funkrufname wird ein Fahrzeug gesucht, nie an der DB-Kennung —
       * dieselbe Spalte, die `KatalogTabelle` als menschenlesbare Kennung fixiert.
       *
       * `numeric: true`, weil Funkrufnamen durchnummeriert sind; rein lexikografisch
       * stünde „Florian 10" vor „Florian 2" [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert bereits `ORDER BY funkrufname`
       * (`src/fahrzeug/repo.rs:74`). Die Sortierung ist hier also ein Angebot —
       * absteigend, und mit `de`-Kollation statt SQLites BINARY-Vergleich — kein
       * neuer Default.
       */
      sorter: (a, b) => a.funkrufname.localeCompare(b.funkrufname, 'de', { numeric: true }),
      /**
       * Die Leitspalte führt auf die Detailseite (LFH-346 · A7). Der Anker-Riegel aus
       * LFH-340 ist hier NICHT nötig: `KatalogTabelle` kennt kein `onZeileKlick` — er
       * betrifft ausschliesslich `Datensicht`, wo Zeilenklick und Link gleichzeitig feuern
       * könnten.
       */
      render: (_, f) => <Link to={fahrzeugDetailPfad(f.id)}>{f.funkrufname}</Link>,
    },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'fahrzeugtyp', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    { title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', render: (t) => t ?? '—' },
    { title: 'Stärke', key: 'staerke', render: (_, f) => staerkeText(f) },
    {
      title: 'Status',
      key: 'dienststatus',
      /**
       * Die einzige geschlossene Achse dieser Tabelle (`Dienststatus` =
       * `in_dienst | ausser_dienst`) und die Frage, die im Einsatz zuerst gestellt
       * wird: welche Fahrzeuge stehen überhaupt zur Verfügung. Typ und Träger sind
       * dagegen Freitext aus den Stammdaten — die bedient die Suche besser als eine
       * Auswahlliste, die mit dem Bestand driftet.
       *
       * BEWUSST WEITERHIN OHNE `dataIndex`: der wäre für den Filter nicht nötig
       * (`onFilter` liest den Datensatz selbst), zöge aber den Drahtwert `in_dienst`
       * in die Freitextsuche des Primitivs — ein Wort, das hier niemand tippt, weil
       * die Zelle „in Dienst" zeigt.
       *
       * `String(wert)`: antd typisiert das Filterargument als `React.Key | boolean`,
       * nicht als unser `Dienststatus`.
       */
      filters: [
        { text: 'in Dienst', value: 'in_dienst' },
        { text: 'außer Dienst', value: 'ausser_dienst' },
      ],
      onFilter: (wert, f) => f.dienststatus === String(wert),
      render: (_, f) =>
        f.dienststatus === 'in_dienst' ? (
          <Tag color="green">in Dienst</Tag>
        ) : (
          <Tag>außer Dienst</Tag>
        ),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, f: Fahrzeug) => {
              /**
               * Eine laufende Mutation gehört GENAU EINER Zeile (LFH-346 · A1). Vorher
               * hing die Sperre am blanken `dienststatusMutation.isPending` — das sperrte
               * JEDE Zeile der Tabelle, während eine einzige Mutation lief; bei 150
               * Personalzeilen eine Vollsperre wegen eines Klicks.
               *
               * Der Riegel gegen ein zweites Absenden DERSELBEN Zeile ist unten im
               * `onConfirm`/`onClick` mitgewandert: ein Klick auf eine ANDERE Zeile ist kein
               * Doppelklick, sondern die nächste Aufgabe — bliebe der Riegel global, sähe
               * der fremde Knopf bedienbar aus und schluckte den Klick.
               *
               * Er hält dabei WENIGER als der alte, und das ist der bewusst gezahlte Preis:
               * EIN `useMutation`-Observer meldet nur den JÜNGSTEN Aufruf, die Marke WANDERT
               * also beim Klick auf eine andere Zeile, statt sich zu sammeln (dieselbe
               * Beobachtung wie in LFH-345). Nach A → B → A ist A wieder klickbar, obwohl
               * seine erste Anfrage noch läuft. Unschädlich, weil der Endpunkt einen Status
               * SETZT (idempotent), nicht umschaltet. Wer das enger will, braucht einen
               * Zustand je Zeile — nicht diese eine Zeile Code.
               */
              const laeuft =
                dienststatusMutation.isPending && dienststatusMutation.variables?.id === f.id;
              return (
                <Space size="middle">
                  <Button
                    disabled={laeuft}
                    onClick={() => {
                      setBearbeite(f);
                      setModalOffen(true);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  {f.dienststatus === 'in_dienst' ? (
                    <Popconfirm
                      title="Außer Dienst stellen?"
                      disabled={laeuft}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: f.id, inDienst: false });
                        }
                      }}
                    >
                      <Button danger loading={laeuft} disabled={laeuft}>
                        Außer Dienst
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      loading={laeuft}
                      disabled={laeuft}
                      onClick={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: f.id, inDienst: true });
                        }
                      }}
                    >
                      Wieder in Dienst
                    </Button>
                  )}
                </Space>
              );
            },
          },
        ] as TableColumnsType<Fahrzeug>)
      : []),
  ];

  return (
    <AdminPage
      titel="Fahrzeuge"
      aktionen={
        /* Der Knopf VERSCHWINDET nicht mehr, wenn das Recht fehlt (M16, LFH-345 · C10) —
           er steht gesperrt, den Grund nennt der Hinweis darunter. Ein fehlender Knopf ist
           von „diese Seite kann das gar nicht" nicht zu unterscheiden; „ausgegraut" allein
           wäre eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1).
           Der Slot liegt AUSSERHALB jedes `<form>` (Dateikopf `AdminPage`) — hier steht
           deshalb nie ein `htmlType="submit"`, sondern immer ein Modal-Öffner. */
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Fahrzeug anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch keine Fahrzeuge" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {fahrzeugeQuery.isError ? (
        <SeitenFehler
          text="Fahrzeuge konnten nicht geladen werden"
          ursache={fahrzeugeQuery.error}
          onWiederholen={() => void fahrzeugeQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={fahrzeugeQuery.isLoading}
          dataSource={fahrzeugeQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Fahrzeuge' }}
          // Durchsucht werden die vier Spalten mit Datenbezug: Funkrufname, Typ, Träger,
          // Kennzeichen. Stärke und Status sind render-only und tragen nichts bei. Der
          // Platzhalter nennt die drei, nach denen tatsächlich gesucht wird — die volle
          // Aufzählung würde im 220 px breiten Feld ohnehin abgeschnitten.
          suche={{ platzhalter: 'Funkrufname, Typ oder Kennzeichen' }}
        />
      )}
      <FahrzeugFormModal
        offen={modalOffen}
        fahrzeug={bearbeite}
        vorschlaege={
          vorschlaegeQuery.data ?? { fahrzeugtyp: [], traegerorganisation: [], standort: [] }
        }
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
