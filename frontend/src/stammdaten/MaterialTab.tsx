import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
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
            render: (_, m: Material) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(m); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                {m.dienststatus === 'in_dienst' ? (
                  <Popconfirm
                    title="Außer Dienst stellen?"
                    onConfirm={() => dienststatusMutation.mutate({ id: m.id, inDienst: false })}
                  >
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: m.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Material>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Material anlegen
        </Button>
      )}
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
    </>
  );
}
