import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereSprechgruppe, listeSprechgruppen } from '../api/sprechgruppen';
import type { Sprechgruppe } from '../api/types';
import SprechgruppeFormModal from './SprechgruppeFormModal';
import { globalKeys } from '../api/queryKeys';

export default function SprechgruppenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Sprechgruppe | null>(null);

  const sprechgruppenQuery = useQuery({
    queryKey: globalKeys.sprechgruppenAlle(),
    queryFn: () => listeSprechgruppen(false),
  });

  const deaktivierenMutation = useMutation({
    mutationFn: (id: number) => deaktiviereSprechgruppe(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.sprechgruppenAlle() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Sprechgruppe> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      // Leitspalte: an der Bezeichnung sucht ein Mensch die Sprechgruppe. `numeric: true`, weil
      // die Bezeichner mit Zahlen beginnen (412_F_DRK) und ein rein zeichenweiser Vergleich
      // 42_… vor 412_… einsortierte. Ohne `defaultSortOrder` — die Voreinstellung bleibt die
      // fachliche Reihenfolge des Backends (`sprechgruppe/repo.rs`:
      // ORDER BY betriebsart, sortier, bezeichnung), die TMO und DMO gruppiert hält.
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }),
    },
    {
      title: 'Betriebsart',
      dataIndex: 'betriebsart',
      key: 'betriebsart',
      // Die Filterwerte stehen fest aus dem Wire-Enum `Betriebsart` ("TMO" | "DMO") und werden
      // NICHT aus den geladenen Zeilen abgeleitet: sonst verschwände genau der Filterwert aus
      // der Liste, dessen Zeilen man gerade sucht, weil keine geladene Zeile ihn trägt.
      filters: [
        { text: 'TMO', value: 'TMO' },
        { text: 'DMO', value: 'DMO' },
      ],
      onFilter: (wert, sg) => sg.betriebsart === wert,
      render: (ba: string) => <Tag color={ba === 'TMO' ? 'blue' : 'orange'}>{ba}</Tag>,
    },
    {
      title: 'Hinweis',
      dataIndex: 'hinweis',
      key: 'hinweis',
      render: (h: string | null) => h ?? '—',
    },
    {
      title: 'Aktiv',
      dataIndex: 'aktiv',
      key: 'aktiv',
      // Zweite Filterachse: der Tab lädt bewusst auch die deaktivierten (`listeSprechgruppen(false)`),
      // wer nur den Bestand im Funkbetrieb sehen will, blendet sie hier weg. Die Spalte behält
      // ihren `dataIndex` (der `render` hängt daran) und fällt damit in den Suchkorpus des
      // Primitivs — „true" trifft jede aktive Zeile. Harmlos, aber kein Wort im Platzhalter wert.
      filters: [
        { text: 'Aktiv', value: true },
        { text: 'Inaktiv', value: false },
      ],
      onFilter: (wert, sg) => sg.aktiv === wert,
      render: (aktiv: boolean) =>
        aktiv ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, sg: Sprechgruppe) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setBearbeite(sg);
                    setModalOffen(true);
                  }}
                >
                  Bearbeiten
                </Button>
                {sg.aktiv && (
                  <Popconfirm
                    title="Sprechgruppe deaktivieren?"
                    onConfirm={() => deaktivierenMutation.mutate(sg.id)}
                  >
                    <Button size="small" danger>
                      Deaktivieren
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Sprechgruppe>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button
          type="primary"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Sprechgruppe anlegen
        </Button>
      )}
      <KatalogTabelle
        rowKey="id"
        loading={sprechgruppenQuery.isLoading}
        dataSource={sprechgruppenQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch keine Sprechgruppen' }}
        suche={{ platzhalter: 'Bezeichnung, Betriebsart oder Hinweis' }}
      />
      <SprechgruppeFormModal
        offen={modalOffen}
        sprechgruppe={bearbeite}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
