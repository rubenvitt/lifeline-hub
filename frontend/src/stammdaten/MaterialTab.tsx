import { Button, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import { monoStil } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { listeKategorien, listeMaterial, setzeDienststatus } from '../api/material';
import type { Material } from '../api/types';
import MaterialFormModal from './MaterialFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { dienststatusSpalten, useDienststatusMutation } from './dienststatus';

export default function MaterialTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Material | null>(null);

  const materialQuery = useQuery({
    queryKey: globalKeys.materialListe('alle'),
    queryFn: () => listeMaterial(false),
  });
  const kategorienQuery = useQuery({
    queryKey: globalKeys.materialKategorien(),
    queryFn: listeKategorien,
  });

  const dienststatusMutation = useDienststatusMutation(setzeDienststatus, globalKeys.material());

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
    {
      title: 'Bestandsnummer',
      dataIndex: 'bestandsnummer',
      key: 'bestandsnummer',
      render: (t) => (t ? <span style={monoStil(13)}>{t}</span> : '—'),
    },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    ...dienststatusSpalten<Material>({
      mutation: dienststatusMutation,
      istAdmin,
      onBearbeiten: (m) => {
        setBearbeite(m);
        setModalOffen(true);
      },
    }),
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
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
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
