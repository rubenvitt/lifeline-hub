import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { listeKategorien, listeMaterial, setzeDienststatus } from '../api/material';
import type { Material } from '../api/types';
import MaterialFormModal from './MaterialFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

export default function MaterialTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Material | null>(null);

  const materialQuery = useQuery({ queryKey: globalKeys.materialListe('alle'), queryFn: () => listeMaterial(false) });
  const kategorienQuery = useQuery({ queryKey: globalKeys.materialKategorien(), queryFn: listeKategorien });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.material() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Material> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      /**
       * Leitspalte: an der Bezeichnung wird ein Materialposten gesucht, nicht an der
       * DB-Kennung — dieselbe Spalte, die `KatalogTabelle` als menschenlesbare Kennung
       * fixiert. `numeric: true`, weil Bezeichnungen Größen tragen („B-Schlauch 5 m"
       * vs. „… 20 m"); rein lexikografisch stünde 20 vor 5 [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert bereits `ORDER BY bezeichnung`
       * (`src/material/repo.rs:54`). Die Sortierung ist ein Angebot — absteigend und
       * mit `de`-Kollation statt SQLites BINARY-Vergleich —, kein neuer Default.
       */
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }),
    },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie', render: (t) => t ?? '—' },
    { title: 'Bestandsnummer', dataIndex: 'bestandsnummer', key: 'bestandsnummer', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'dienststatus',
      /**
       * Gefiltert wird über den Dienststatus, nicht über die Kategorie: `Dienststatus`
       * ist ein geschlossenes Enum (`in_dienst | ausser_dienst`) und beantwortet die
       * Frage, die im Einsatz zuerst gestellt wird. Die Kategorie ist mandantengepflegt
       * — eine Filterliste daraus (`kategorienQuery`) käme aus einer zweiten Abfrage und
       * könnte mit den angezeigten Zeilen auseinanderlaufen; sie hat einen `dataIndex`
       * und wird deshalb bereits von der Freitextsuche bedient.
       *
       * BEWUSST WEITERHIN OHNE `dataIndex` (Begründung wie in `FahrzeugeTab`): der
       * Filter braucht keinen, ein gesetzter zöge aber den Drahtwert `in_dienst` in die
       * Suche. `String(wert)`, weil antd das Filterargument als `React.Key | boolean`
       * typisiert.
       */
      filters: [
        { text: 'in Dienst', value: 'in_dienst' },
        { text: 'außer Dienst', value: 'ausser_dienst' },
      ],
      onFilter: (wert, m) => m.dienststatus === String(wert),
      render: (_, m) =>
        m.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, m: Material) => {
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
                dienststatusMutation.isPending && dienststatusMutation.variables?.id === m.id;
              return (
                <Space size="middle">
                  <Button disabled={laeuft} onClick={() => { setBearbeite(m); setModalOffen(true); }}>
                    Bearbeiten
                  </Button>
                  {m.dienststatus === 'in_dienst' ? (
                    <Popconfirm
                      title="Außer Dienst stellen?"
                      disabled={laeuft}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: m.id, inDienst: false });
                        }
                      }}
                    >
                      <Button danger loading={laeuft} disabled={laeuft}>Außer Dienst</Button>
                    </Popconfirm>
                  ) : (
                    <Button loading={laeuft} disabled={laeuft}
                      onClick={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: m.id, inDienst: true });
                        }
                      }}>
                      Wieder in Dienst
                    </Button>
                  )}
                </Space>
              );
            },
          },
        ] as TableColumnsType<Material>)
      : []),
  ];

  return (
    <AdminPage
      titel="Material"
      aktionen={
        /* Der Knopf VERSCHWINDET nicht mehr, wenn das Recht fehlt (M16, LFH-345 · C10) —
           er steht gesperrt, den Grund nennt der Hinweis darunter. Ein fehlender Knopf ist
           von „diese Seite kann das gar nicht" nicht zu unterscheiden; „ausgegraut" allein
           wäre eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1).
           Der Slot liegt AUSSERHALB jedes `<form>` (Dateikopf `AdminPage`) — hier steht
           deshalb nie ein `htmlType="submit"`, sondern immer ein Modal-Öffner. */
        <Button type="primary" disabled={!istAdmin} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Material anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch kein Material" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {materialQuery.isError ? (
        <SeitenFehler
          text="Material konnte nicht geladen werden"
          ursache={materialQuery.error}
          onWiederholen={() => void materialQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={materialQuery.isLoading}
          dataSource={materialQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Noch kein Material' }}
          // Durchsucht werden die vier Spalten mit Datenbezug: Bezeichnung, Kategorie,
          // Bestandsnummer, Träger. Die Statusspalte ist render-only und trägt nichts bei.
          // Der Platzhalter nennt die beiden, nach denen tatsächlich gesucht wird — die
          // volle Aufzählung würde im 220 px breiten Feld abgeschnitten.
          suche={{ platzhalter: 'Bezeichnung oder Kategorie' }}
        />
      )}
      <MaterialFormModal
        offen={modalOffen}
        material={bearbeite}
        kategorien={kategorienQuery.data ?? []}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
