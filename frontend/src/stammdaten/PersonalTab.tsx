import { Button, Space, Tag, type TableColumnsType } from 'antd';
import { Link } from 'react-router';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  ladePersonalVorschlaege,
  listePersonal,
  POSITION_LABELS,
  setzeDienststatus,
} from '../api/personal';
import type { Personal } from '../api/types';
import PersonalFormModal from './PersonalFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { personalDetailPfad } from './stammdatenDetail';
import { dienststatusSpalten, useDienststatusMutation } from './dienststatus';

export default function PersonalTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Personal | null>(null);

  const personalQuery = useQuery({
    queryKey: globalKeys.personalListe('alle'),
    queryFn: () => listePersonal(false),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.personalVorschlaege(),
    queryFn: ladePersonalVorschlaege,
  });

  const dienststatusMutation = useDienststatusMutation(setzeDienststatus, globalKeys.personal());

  const spalten: TableColumnsType<Personal> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      /**
       * Leitspalte: an ihr sucht ein Mensch die Person, deshalb sitzt die Sortierung hier
       * und nicht an der Datenbank-Kennung. Der Server sortiert zwar bereits
       * (`src/personal/repo.rs:178` — `ORDER BY name`), aber über SQLites
       * Standardkollation, also byteweise: „Öttinger" landet dort hinter „Zimmer" und
       * „albert" hinter allem Großgeschriebenen. Der Vergleich hier ist sprachbewusst und
       * gibt zusätzlich die Gegenrichtung her. Kein `defaultSortOrder` — die
       * Serverreihenfolge bleibt der Einstieg, die Sortierung ist ein Angebot.
       */
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
      /**
       * Die Leitspalte führt auf die Detailseite (LFH-346 · A7). Kein Anker-Riegel nötig —
       * `KatalogTabelle` kennt kein `onZeileKlick` (Begründung in `FahrzeugeTab`).
       *
       * Der `dataIndex` bleibt stehen: die Freitextsuche des Primitivs liest die ROHWERTE
       * der Spalten mit `dataIndex`, nicht das Gerenderte — ohne ihn fiele der Name aus dem
       * Suchkorpus, den der Platzhalter als erstes verspricht.
       */
      render: (_, p) => <Link to={personalDetailPfad(p.id)}>{p.name}</Link>,
    },
    {
      title: 'Personalnr.',
      dataIndex: 'personalnummer',
      key: 'personalnummer',
      render: (t) => t ?? '—',
    },
    {
      title: 'Qualifikationen',
      key: 'qualifikationen',
      render: (_, p) =>
        p.qualifikationen.length ? (
          <Space size={[0, 4]} wrap>
            {p.qualifikationen.map((q) => (
              <Tag key={q.id}>{q.label}</Tag>
            ))}
          </Space>
        ) : (
          '—'
        ),
    },
    {
      title: 'Stärke-Position',
      key: 'staerke_position',
      /**
       * Bewusst OHNE `dataIndex` — dieselbe Regel, die unten an `dienststatus` schon richtig
       * stand und hier verletzt war. Gemessen mit `dataIndex: 'staerke_position'`: die
       * Drahtwerte lagen im Suchkorpus des Primitivs, „mann" und „sch" trafen jede
       * Mannschafts-Person (`mannschaft`), während „Führer" mit Umlaut NICHTS traf — genau
       * verkehrt herum zu dem, was der Platzhalter verspricht. `render` bekommt den ganzen
       * Datensatz, die Spalte zeigt unverändert dasselbe.
       */
      render: (_, p) => (p.staerke_position ? POSITION_LABELS[p.staerke_position] : '—'),
    },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    ...dienststatusSpalten<Personal>({
      mutation: dienststatusMutation,
      istAdmin,
      onBearbeiten: (p) => {
        setBearbeite(p);
        setModalOffen(true);
      },
    }),
  ];

  return (
    <AdminPage
      titel="Personal"
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
          Person anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch kein Personal" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {personalQuery.isError ? (
        <SeitenFehler
          text="Personal konnte nicht geladen werden"
          ursache={personalQuery.error}
          onWiederholen={() => void personalQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={personalQuery.isLoading}
          dataSource={personalQuery.data ?? []}
          columns={spalten}
          /**
           * Die Suche des Primitivs liest die ROHWERTE der Spalten mit `dataIndex`, nicht das
           * Gerenderte (Dateikopf `components/KatalogTabelle.tsx`). Der Platzhalter nennt
           * deshalb genau die drei Spalten, die auch beitragen: Name, Personalnr., Träger.
           * Qualifikationen, Stärke-Position und Status sind Render-Spalten ohne Datenbezug und
           * tragen zur Suche NICHTS bei — bei den letzten beiden ist das gewollt und geprüft
           * (`PersonalTab.test.tsx`), sonst lägen ihre Drahtwerte (`mannschaft`, `in_dienst`)
           * im Korb und die Suche träfe Zeilen, die niemand gemeint hat.
           */
          suche={{ platzhalter: 'Name, Personalnr. oder Träger' }}
          locale={{ emptyText: 'Noch kein Personal' }}
        />
      )}
      <PersonalFormModal
        offen={modalOffen}
        person={bearbeite}
        vorschlaege={vorschlaegeQuery.data ?? { traegerorganisation: [] }}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
