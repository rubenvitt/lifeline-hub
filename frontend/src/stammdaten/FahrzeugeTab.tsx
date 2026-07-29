import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
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

  const fahrzeugeQuery = useQuery({ queryKey: globalKeys.fahrzeugeListe('alle'), queryFn: () => listeFahrzeuge(false) });
  const vorschlaegeQuery = useQuery({ queryKey: globalKeys.fahrzeugVorschlaege(), queryFn: ladeFahrzeugVorschlaege });

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
        f.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, f: Fahrzeug) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(f); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                {f.dienststatus === 'in_dienst' ? (
                  <Popconfirm
                    title="Außer Dienst stellen?"
                    onConfirm={() => dienststatusMutation.mutate({ id: f.id, inDienst: false })}
                  >
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: f.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Fahrzeug>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Fahrzeug anlegen
        </Button>
      )}
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
        vorschlaege={vorschlaegeQuery.data ?? { fahrzeugtyp: [], traegerorganisation: [], standort: [] }}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
