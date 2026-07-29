import { Alert, App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { listeOnlineQuellen, loescheOnlineQuelle, type OnlineQuelle } from '../api/onlineQuellen';
import { invalidiereKarte } from './invalidiereKarte';
import OnlineQuelleFormModal from './OnlineQuelleFormModal';
import AusKatalogModal from './AusKatalogModal';
import { globalKeys } from '../api/queryKeys';

/**
 * Verwaltungstabelle der Online-Basemap-Quellen. Lesen für alle Admin-Bereichs-
 * Berechtigten; Schreiben (Anlegen/Katalog/Bearbeiten/Löschen) nur System-Admin.
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
  // Stabile Identität (react-query liefert data referenz-stabil) → der Set-useMemo unten
  // läuft nicht bei jedem Render neu.
  const quellen = useMemo(() => quellenQuery.data ?? [], [quellenQuery.data]);

  const vorhandeneUrls = useMemo(() => new Set(quellen.map((q) => q.url)), [quellen]);
  const naechsteSortier = quellen.reduce((max, q) => Math.max(max, q.sortier), 0) + 1;

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheOnlineQuelle(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  const spalten: TableColumnsType<OnlineQuelle> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      /**
       * Leitspalte: am Namen sucht ein Mensch die Quelle, nie an der DB-Kennung — dieselbe
       * Spalte, die `KatalogTabelle` als menschenlesbare Kennung fixiert.
       *
       * KEIN `defaultSortOrder`: das Backend liefert `ORDER BY sortier, id`
       * (`src/karte/registry/repo.rs:141`), und `sortier` ist die vom Admin gesetzte
       * Reihenfolge des Basemap-Switchers — genau die, die der Nutzer der Lagekarte zu
       * sehen bekommt. Sie bleibt Voreinstellung; die alphabetische Sortierung ist ein
       * Angebot, das der dritte Kopfklick zurücknimmt.
       */
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
    },
    {
      title: 'Typ',
      dataIndex: 'typ',
      key: 'typ',
      /**
       * BEWUSST OHNE `filters`, und das ist keine Auslassung: das Etikett zeigt den
       * Drahtwert selbst (`{t}` → „vektor"/„raster"), der `dataIndex` trägt ihn damit
       * ehrlich in die Freitextsuche — „raster" tippen siebt bereits. Ein Filter wäre eine
       * zweite Tür in denselben Raum.
       *
       * Gegenstück ist „Aktiv" weiter unten: dort steht ein Wahrheitswert, den keine
       * Suche erreicht — deshalb trägt jene Spalte den Filter und diese nicht.
       */
      render: (t: OnlineQuelle['typ']) => <Tag color={t === 'vektor' ? 'blue' : 'geekblue'}>{t}</Tag>,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      render: (u: string) => (
        <span style={{ fontSize: 12, wordBreak: 'break-all' }} title={u}>
          {u}
        </span>
      ),
    },
    { title: 'Attribution', dataIndex: 'attribution', key: 'attribution', render: (a: string | null) => a ?? '—' },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      // Numerisch vergleichen, nicht über die Zeichenkette: nur so steht 5 vor 40.
      sorter: (a, b) => a.sortier - b.sortier,
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      /**
       * Die eine geschlossene Achse dieser Tabelle — und sie existiert wirklich in den
       * DATEN: die Verwaltungsliste kommt ungefiltert aus `karte_online_quelle`
       * (`src/karte/registry/repo.rs:141`), anders als der Switcher-Pfad daneben
       * (`:73`, `WHERE aktiv = 1`). Inaktive Quellen stehen hier also mit drin, und
       * „welche erscheint überhaupt in der Lagekarte?" ist die erste Frage an diese Tabelle.
       * Genau daran scheiterte der Filter bei Qualifikationen und Einheitentypen: dort siebt
       * schon der Server, clientseitig bliebe nichts zu filtern.
       *
       * KEIN `dataIndex` (Norm der Katalogtabellen): der Filter braucht ihn nicht
       * (`onFilter` liest den Datensatz selbst), zöge aber den Wahrheitswert in die
       * Freitextsuche — „true" träfe dann jede aktive Quelle, ein Wort, das in keiner Zelle
       * steht. Die Kehrseite ist der Grund für den Filter: ein Wahrheitswert ist über die
       * Suche NICHT erreichbar, das Filtermenü ist sein einziger Zugang.
       *
       * Die Werte sind Wahrheitswerte statt Zeichenketten — antd typisiert das
       * Filterargument als `React.Key | boolean`, ein `String(wert)`-Umweg wie bei den
       * Enum-Achsen der Stammdaten ist hier also nicht nötig.
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
            render: (_, q: OnlineQuelle) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(q); setFormOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm
                  title="Quelle löschen?"
                  okText="Löschen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => loeschenMutation.mutate(q.id)}
                >
                  <Button size="small" danger>Löschen</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<OnlineQuelle>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => { setBearbeite(null); setFormOffen(true); }}>
            Quelle hinzufügen
          </Button>
          <Button onClick={() => setKatalogOffen(true)}>Aus Katalog hinzufügen</Button>
        </Space>
      )}
      {quellenQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Online-Quellen konnten nicht geladen werden"
          description={quellenQuery.error instanceof ApiError ? quellenQuery.error.message : undefined}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={quellenQuery.isLoading}
          dataSource={quellen}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Online-Quellen' }}
          // Durchsucht werden die Spalten mit Datenbezug: Name, Typ, URL, Attribution und
          // (technisch mit) Sortierung. „Aktiv" trägt bewusst keinen `dataIndex` und bleibt
          // dem Filter vorbehalten. Der Platzhalter nennt die drei Felder, nach denen
          // tatsächlich getippt wird — die volle Aufzählung würde im 220 px breiten Feld
          // ohnehin abgeschnitten.
          suche={{ platzhalter: 'Name, URL oder Attribution' }}
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
