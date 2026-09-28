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
import { StatusChip } from '../components/instrument';

export default function PersonalTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
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

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.personal() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Personal> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
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
       * Bewusst OHNE `dataIndex`: sonst lägen die Drahtwerte im Suchkorpus, „mann" und „sch"
       * träfen jede Mannschafts-Person (`mannschaft`), „Führer" mit Umlaut dagegen nichts. `render`
       * bekommt den ganzen Datensatz.
       */
      render: (_, p) => (p.staerke_position ? POSITION_LABELS[p.staerke_position] : '—'),
    },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'dienststatus',
      /**
       * Der Filter kommt OHNE `dataIndex` aus: `onFilter` bekommt den ganzen Datensatz. Ein Bezug
       * zöge den Drahtwert `in_dienst` in die Freitextsuche — wer „in Dienst" tippt, fände nichts.
       */
      filters: [
        { text: 'in Dienst', value: 'in_dienst' },
        { text: 'außer Dienst', value: 'ausser_dienst' },
      ],
      onFilter: (wert, p) => p.dienststatus === wert,
      render: (_, p) =>
        p.dienststatus === 'in_dienst' ? (
          <StatusChip ton="normal" wort="in Dienst" />
        ) : (
          <StatusChip ton="neutral" wort="außer Dienst" />
        ),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, p: Personal) => {
              /**
               * Eine laufende Mutation gehört GENAU EINER Zeile (LFH-346): eine Sperre an
               * `dienststatusMutation.isPending` legte die ganze Tabelle still.
               *
               * Der Riegel gegen ein zweites Absenden DERSELBEN Zeile sitzt im `onConfirm`/`onClick`: ein
               * Klick auf eine ANDERE Zeile ist die nächste Aufgabe, kein Doppelklick.
               *
               * Er hält bewusst WENIGER: EIN `useMutation`-Observer meldet nur den JÜNGSTEN Aufruf, die
               * Marke WANDERT also. Nach A → B → A ist A wieder klickbar, obwohl seine erste Anfrage noch
               * läuft. Unschädlich, weil der Endpunkt einen Status SETZT (idempotent). Enger ginge es nur
               * mit einem Zustand je Zeile.
               */
              const laeuft =
                dienststatusMutation.isPending && dienststatusMutation.variables?.id === p.id;
              return (
                <Space size="middle">
                  <Button
                    disabled={laeuft}
                    onClick={() => {
                      setBearbeite(p);
                      setModalOffen(true);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  {p.dienststatus === 'in_dienst' ? (
                    <Popconfirm
                      title="Außer Dienst stellen?"
                      disabled={laeuft}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: p.id, inDienst: false });
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
                          dienststatusMutation.mutate({ id: p.id, inDienst: true });
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
        ] as TableColumnsType<Personal>)
      : []),
  ];

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
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
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
          dataSource={personalQuery.data ?? []}
          columns={spalten}
          /**
           * Die Suche liest die ROHWERTE der Spalten mit `dataIndex`, nicht das Gerenderte. Der
           * Platzhalter nennt genau die drei Spalten, die beitragen: Name, Personalnr., Träger.
           * Stärke-Position und Status tragen gewollt nichts bei (geprüft in `PersonalTab.test.tsx`),
           * sonst träfen ihre Drahtwerte (`mannschaft`, `in_dienst`) Zeilen, die niemand gemeint hat.
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
