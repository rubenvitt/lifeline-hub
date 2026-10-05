import { App, Button, Popconfirm, Space, Tag } from 'antd';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fehlerText } from '../api/client';
import { listeOnlineQuellen, loescheOnlineQuelle, type OnlineQuelle } from '../api/onlineQuellen';
import { invalidiereKarte } from './invalidiereKarte';
import OnlineQuelleFormModal from './OnlineQuelleFormModal';
import AusKatalogModal from './AusKatalogModal';
import { globalKeys } from '../api/queryKeys';

/**
 * Verwaltungstabelle der Online-Basemap-Quellen. Lesen für alle Admin-Bereichs-Berechtigten;
 * Schreiben nur System-Admin.
 */
export default function OnlineQuellenVerwaltung() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [formOffen, setFormOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<OnlineQuelle | null>(null);
  const [katalogOffen, setKatalogOffen] = useState(false);

  const quellenQuery = useQuery({
    queryKey: globalKeys.adminKarteBereich('online-quellen'),
    queryFn: listeOnlineQuellen,
  });
  // `data` ist referenzstabil, der Set-useMemo unten läuft also nicht je Render neu.
  const quellen = useMemo(() => quellenQuery.data ?? [], [quellenQuery.data]);

  const vorhandeneUrls = useMemo(() => new Set(quellen.map((q) => q.url)), [quellen]);
  const naechsteSortier = quellen.reduce((max, q) => Math.max(max, q.sortier), 0) + 1;

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheOnlineQuelle(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(fehlerText(e, 'Löschen fehlgeschlagen')),
  });

  const spalten: KatalogSpalte<OnlineQuelle>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      /**
       * Leitspalte: am Namen sucht ein Mensch die Quelle, nie an der DB-Kennung.
       * KEIN `defaultSortOrder`: das Backend liefert `ORDER BY sortier, id`, und `sortier` ist die vom
       * Admin gesetzte Reihenfolge des Basemap-Switchers. Sie bleibt Vorgabe; alphabetisch ist ein
       * Angebot, das der dritte Kopfklick zurücknimmt.
       */
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
    },
    {
      title: 'Typ',
      dataIndex: 'typ',
      key: 'typ',
      /**
       * BEWUSST OHNE `filters`: das Etikett zeigt den Drahtwert selbst, der `dataIndex` trägt ihn in
       * die Freitextsuche — „raster" tippen siebt bereits. Gegenstück ist „Aktiv", dessen
       * Wahrheitswert keine Suche erreicht.
       */
      // Neutral (LFH-891): der Typ ist eine Kennzeichnung, das Wort trägt ihn; Blau bedient.
      render: (t: OnlineQuelle['typ']) => <Tag>{t}</Tag>,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      /**
       * Eine Kachel-URL ist 60–200 Zeichen lang und trägt ihre Aussage vorn; umgebrochen triebe sie
       * die Zeilenhöhe. `showTitle` hält den vollen Wert erreichbar. Kein eigenes `render`, damit
       * Klasse, Kappung und Titel an EINEM Knoten sitzen.
       *
       * DIE KAPPUNG SITZT AN DER ZELLE, NICHT AN DER SPALTE: unter `scroll={{ x: 'max-content' }}`
       * mit fixierter erster Spalte wählt rc-table `table-layout: auto`, und dort ist eine
       * Spaltenbreite nur ein Wunsch (im Browser gemessen: trotz `<col width="280">` ungekürzt;
       * antds `.ant-table-cell-ellipsis` senkt den Platzbedarf nicht). `maxWidth` bindet — und eine
       * zusätzliche `width` wäre ein Verstoß gegen `components/feldbreiten.guard.test.ts`.
       */
      ellipsis: { showTitle: true },
      onCell: () => ({ style: { maxWidth: 280 } }),
      // Gekappter Freitext mit der schwächsten Vergleichsaussage — fällt unter `lg` weg und wird vom
      // Spaltenschalter mitgezählt.
      abBreite: 'lg',
    },
    {
      title: 'Attribution',
      dataIndex: 'attribution',
      key: 'attribution',
      // Freitext wie die URL — gleiche Bauform, gleiche Begründung.
      ellipsis: { showTitle: true },
      onCell: () => ({ style: { maxWidth: 200 } }),
      render: (a: string | null) => a ?? '—',
      abBreite: 'lg',
    },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      // Numerisch vergleichen: nur so steht 5 vor 40.
      sorter: (a, b) => a.sortier - b.sortier,
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      /**
       * Die geschlossene Achse dieser Tabelle, wirklich in den Daten: die Verwaltungsliste kommt
       * ungefiltert (der Switcher-Pfad siebt `WHERE aktiv = 1`), und „erscheint sie in der
       * Lagekarte?" ist die erste Frage an diese Tabelle.
       *
       * KEIN `dataIndex`: der Filter braucht ihn nicht, zöge aber „true" in die Freitextsuche. Ein
       * Wahrheitswert ist über die Suche nicht erreichbar, der Filter ist sein einziger Zugang.
       * Die Werte sind Wahrheitswerte — antd typisiert das Filterargument als `React.Key | boolean`.
       */
      filters: [
        { text: 'aktiv', value: true },
        { text: 'inaktiv', value: false },
      ],
      onFilter: (wert, q) => q.aktiv === wert,
      render: (_, q) => (q.aktiv ? <Tag color="green">aktiv</Tag> : <Tag>inaktiv</Tag>),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            // Die Zeilenaktionen sind kein Vergleichsgegenstand — nicht abwählbar.
            immerSichtbar: true,
            render: (_, q: OnlineQuelle) => (
              // `size="middle"` trennt die destruktive von der neutralen Aktion
              // (`components/aktionsabstand.guard.test.ts`).
              <Space size="middle">
                <Button
                  onClick={() => {
                    setBearbeite(q);
                    setFormOffen(true);
                  }}
                >
                  Bearbeiten
                </Button>
                <Popconfirm
                  title="Quelle löschen?"
                  okText="Löschen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => loeschenMutation.mutate(q.id)}
                >
                  <Button danger>Löschen</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as KatalogSpalte<OnlineQuelle>[])
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Space style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            onClick={() => {
              setBearbeite(null);
              setFormOffen(true);
            }}
          >
            Quelle hinzufügen
          </Button>
          <Button onClick={() => setKatalogOffen(true)}>Aus Katalog hinzufügen</Button>
        </Space>
      )}
      {/* Wiederholt wird GENAU diese Query: `invalidiereKarte` zöge Katalog und Karten-Config mit, die
         nicht gescheitert sind. */}
      {quellenQuery.isError ? (
        <SeitenFehler
          text="Online-Quellen konnten nicht geladen werden"
          ursache={quellenQuery.error}
          onWiederholen={() => void quellenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={quellenQuery.isLoading}
          dataSource={quellen}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Online-Quellen' }}
          // Durchsucht werden Name, Typ, URL, Attribution und (technisch) Sortierung; „Aktiv" bleibt dem
          // Filter vorbehalten. Der Platzhalter nennt die drei Felder, nach denen getippt wird.
          suche={{ platzhalter: 'Name, URL oder Attribution' }}
          // Umschaltbarer Spaltensatz mit Zähler; Name ist Spalte 0 und nie abwählbar.
          spaltenSchalter={{ bezeichnung: 'Online-Quellen' }}
        />
      )}
      <OnlineQuelleFormModal
        offen={formOffen}
        quelle={bearbeite}
        naechsteSortier={naechsteSortier}
        onClose={() => setFormOffen(false)}
      />
      <AusKatalogModal
        offen={katalogOffen}
        vorhandeneUrls={vorhandeneUrls}
        naechsteSortier={naechsteSortier}
        onClose={() => setKatalogOffen(false)}
      />
    </>
  );
}
