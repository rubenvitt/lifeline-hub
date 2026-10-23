import { Button, Space, Tag } from 'antd';
import DemoMarke from '../components/DemoMarke';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { useViewport } from '../components/useViewport';
import { nachText, nachZahl, werteAus } from '../components/katalogVergleich';
import { useListenGedaechtnis } from '../components/listenGedaechtnis';
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
import type { Personal, StaerkePosition } from '../api/types';
import PersonalFormModal from './PersonalFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { personalDetailPfad } from './stammdatenDetail';
import { DIENSTSTATUS_FEHLER, dienststatusSpalten, useDienststatusMutation } from './dienststatus';
import { KennungsLink } from '../components/kennungsLink';

const POSITION_FOLGE = Object.keys(POSITION_LABELS) as StaerkePosition[];

export default function PersonalTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const { istSchmal } = useViewport();
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

  const personen = personalQuery.data ?? [];
  // Qualifikationen und Träger filtern mit den Werten der Zeilen (LLH-1096); ohne Wert kein Trichter.
  const qualifikationWerte = werteAus(personen, (p) => p.qualifikationen.map((q) => q.label));
  const traegerWerte = werteAus(personen, (p) => p.traegerorganisation);

  // Stärke-Position und Träger sind nachrangig und fallen unter `lg` weg; der Spaltenschalter
  // zählt sie und holt sie zurück (LFH-980).
  const spalten: KatalogSpalte<Personal>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      // Unter `md` gedeckelt, damit Status und Aktionen rechts daneben im Bild bleiben (LFH-980).
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      /**
       * Leitspalte: an ihr sucht ein Mensch die Person. Der Server sortiert zwar schon
       * (`ORDER BY name`), aber über SQLites Standardkollation byteweise: „Öttinger" landet hinter
       * „Zimmer", „albert" hinter allem Großgeschriebenen. Der Vergleich hier ist sprachbewusst und
       * gibt die Gegenrichtung her. Kein `defaultSortOrder` — die Serverreihenfolge bleibt der
       * Einstieg, die Sortierung ist ein Angebot.
       */
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
      /**
       * Die Leitspalte führt auf die Detailseite. Kein Anker-Riegel nötig — `KatalogTabelle` kennt
       * kein `onZeileKlick` (Begründung in `FahrzeugeTab`).
       *
       * Der `dataIndex` bleibt: die Freitextsuche liest die ROHWERTE der Spalten mit `dataIndex`,
       * ohne ihn fiele der Name aus dem Suchkorpus.
       */
      render: (_, p) => (
        <Space size={4} wrap>
          <KennungsLink to={personalDetailPfad(p.id)} style={{ overflowWrap: 'anywhere' }}>
            {p.name}
          </KennungsLink>
          {p.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    {
      title: 'Personalnr.',
      dataIndex: 'personalnummer',
      key: 'personalnummer',
      sorter: nachText((p: Personal) => p.personalnummer),
      render: (t) => t ?? '—',
    },
    {
      title: 'Qualifikationen',
      key: 'qualifikationen',
      // Eine Person trägt mehrere: der Filter trifft, wer den Wert unter seinen hat. Ohne Sortierung,
      // eine Menge hat keine Folge.
      filters: qualifikationWerte.length > 0 ? qualifikationWerte : undefined,
      onFilter: (wert, p) => p.qualifikationen.some((q) => q.label === wert),
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
      abBreite: 'lg',
      /**
       * Bewusst OHNE `dataIndex`: sonst lägen die Drahtwerte im Suchkorpus, „mann" und „sch"
       * träfen jede Mannschafts-Person (`mannschaft`), „Führer" mit Umlaut dagegen nichts. `render`
       * bekommt den ganzen Datensatz.
       */
      filters: POSITION_FOLGE.map((pos) => ({ text: POSITION_LABELS[pos], value: pos })),
      onFilter: (wert, p) => p.staerke_position === wert,
      // In der Folge Führer, Unterführer, Mannschaft, nicht nach dem Wort.
      sorter: nachZahl((p: Personal) =>
        p.staerke_position ? POSITION_FOLGE.indexOf(p.staerke_position) : null,
      ),
      render: (_, p) => (p.staerke_position ? POSITION_LABELS[p.staerke_position] : '—'),
    },
    {
      title: 'Träger',
      dataIndex: 'traegerorganisation',
      key: 'traeger',
      abBreite: 'lg',
      sorter: nachText((p: Personal) => p.traegerorganisation),
      filters: traegerWerte.length > 0 ? traegerWerte : undefined,
      onFilter: (wert, p) => p.traegerorganisation === wert,
      render: (t) => t ?? '—',
    },
    ...dienststatusSpalten<Personal>({
      mutation: dienststatusMutation,
      istAdmin,
      schmal: istSchmal,
      kennung: (p) => `Person ${p.name}`,
      onBearbeiten: (p) => {
        setBearbeite(p);
        setModalOffen(true);
      },
    }),
  ];

  // Stand in der Adresse (LLH-1096); Einstieg bleibt die Reihenfolge des Servers.
  const gedaechtnis = useListenGedaechtnis('stammdaten-personal', spalten, {
    ausDaten: ['qualifikationen', 'traeger'],
  });

  return (
    <AdminPage
      titel="Personal"
      aktionen={
        /* Der Knopf steht ohne Recht gesperrt, den Grund nennt der Hinweis (LFH-345): ein fehlender
           Knopf ist von „diese Seite kann das gar nicht" nicht zu unterscheiden, „ausgegraut" allein
           wäre eine Ein-Kanal-Aussage (WCAG 1.4.1). Der Slot liegt AUSSERHALB jedes `<form>`
           (`AdminPage`) — hier steht deshalb ein Modal-Öffner, nie ein `htmlType="submit"`. */
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
      hinweis={
        <SeitenHinweise
          fehler={dienststatusMutation.error}
          {...DIENSTSTATUS_FEHLER}
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Noch
         kein Personal" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
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
          dataSource={personen}
          columns={spalten}
          gedaechtnis={gedaechtnis}
          mehrzahl="Personen"
          /**
           * Die Suche liest die ROHWERTE der Spalten mit `dataIndex`, nicht das Gerenderte. Der
           * Platzhalter nennt genau die drei Spalten, die beitragen: Name, Personalnr., Träger.
           * Stärke-Position und Status tragen gewollt nichts bei (geprüft in `PersonalTab.test.tsx`),
           * sonst träfen ihre Drahtwerte (`mannschaft`, `in_dienst`) Zeilen, die niemand gemeint hat.
           */
          suche={{ platzhalter: 'Name, Personalnr. oder Träger' }}
          spaltenSchalter={{ bezeichnung: 'Personal' }}
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
