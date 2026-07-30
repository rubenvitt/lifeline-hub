import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladePersonalVorschlaege, listePersonal, POSITION_LABELS, setzeDienststatus } from '../api/personal';
import type { Personal } from '../api/types';
import PersonalFormModal from './PersonalFormModal';
import { globalKeys } from '../api/queryKeys';

export default function PersonalTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Personal | null>(null);

  const personalQuery = useQuery({ queryKey: globalKeys.personalListe('alle'), queryFn: () => listePersonal(false) });
  const vorschlaegeQuery = useQuery({ queryKey: globalKeys.personalVorschlaege(), queryFn: ladePersonalVorschlaege });

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
       * Leitspalte: an ihr sucht ein Mensch die Person, deshalb sitzt die Sortierung hier
       * und nicht an der Datenbank-Kennung. Der Server sortiert zwar bereits
       * (`src/personal/repo.rs:178` — `ORDER BY name`), aber über SQLites
       * Standardkollation, also byteweise: „Öttinger" landet dort hinter „Zimmer" und
       * „albert" hinter allem Großgeschriebenen. Der Vergleich hier ist sprachbewusst und
       * gibt zusätzlich die Gegenrichtung her. Kein `defaultSortOrder` — die
       * Serverreihenfolge bleibt der Einstieg, die Sortierung ist ein Angebot.
       */
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
    },
    { title: 'Personalnr.', dataIndex: 'personalnummer', key: 'personalnummer', render: (t) => t ?? '—' },
    {
      title: 'Qualifikationen',
      key: 'qualifikationen',
      render: (_, p) =>
        p.qualifikationen.length ? (
          <Space size={[0, 4]} wrap>
            {p.qualifikationen.map((q) => <Tag key={q.id}>{q.label}</Tag>)}
          </Space>
        ) : '—',
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
    {
      title: 'Status',
      key: 'dienststatus',
      /**
       * Der Filter kommt bewusst OHNE `dataIndex` aus: `onFilter` bekommt den ganzen
       * Datensatz. Ein Bezug wäre hier nicht bloß überflüssig, sondern schädlich — er zöge
       * den Drahtwert `in_dienst` in die Freitextsuche des Primitivs, die Rohwerte liest;
       * wer „in Dienst" tippt, fände dann nichts, wer „in_dienst" tippt, alles.
       */
      filters: [
        { text: 'in Dienst', value: 'in_dienst' },
        { text: 'außer Dienst', value: 'ausser_dienst' },
      ],
      onFilter: (wert, p) => p.dienststatus === wert,
      render: (_, p) =>
        p.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, p: Personal) => (
              <Space size="middle">
                <Button onClick={() => { setBearbeite(p); setModalOffen(true); }}>Bearbeiten</Button>
                {p.dienststatus === 'in_dienst' ? (
                  <Popconfirm
                    title="Außer Dienst stellen?"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => dienststatusMutation.mutate({ id: p.id, inDienst: false })}
                  >
                    <Button danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button onClick={() => dienststatusMutation.mutate({ id: p.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Personal>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Person anlegen
        </Button>
      )}
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
    </>
  );
}
