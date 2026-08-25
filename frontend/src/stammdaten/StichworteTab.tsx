import { App, Button, Input, Popconfirm, Space, Typography, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
} from '../api/stichwortVorschlaege';
import type { StichwortVorschlag } from '../api/types';
import { globalKeys } from '../api/queryKeys';

export default function StichworteTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerText, setNeuerText] = useState('');

  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });

  const anlegenMutation = useMutation({
    mutationFn: (text: string) => legeStichwortVorschlagAn(text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() });
      setNeuerText('');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Hinzufügen fehlgeschlagen'),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  function hinzufuegen() {
    const text = neuerText.trim();
    if (text) anlegenMutation.mutate(text);
  }

  const vorschlaege = vorschlaegeQuery.data ?? [];

  const spalten: TableColumnsType<StichwortVorschlag> = [
    {
      title: 'Stichwort',
      dataIndex: 'text',
      key: 'text',
      /**
       * Leitspalte: das Stichwort ist das einzige fachliche Merkmal des Datensatzes
       * (`StichwortVorschlag` = `{ id, text }`), an ihm sucht ein Mensch — nicht an der
       * DB-Kennung.
       *
       * `numeric: true`, weil die Stichworte durchnummeriert sind (H1, H2, … H10);
       * rein lexikografisch stünde H10 vor H2 [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert `ORDER BY sortier, text`
       * (`src/stichwort/mod.rs:17`), also eine gepflegte fachliche Reihenfolge. Sie
       * bleibt die Voreinstellung, die Sortierung ist ein Angebot. Wichtig, weil die
       * Antwort `sortier` gar nicht mitträgt — einmal weggeworfen, könnte das Frontend
       * die fachliche Reihenfolge nicht wiederherstellen; nur der dritte Kopfklick
       * (antd: aufsteigend → absteigend → aus) holt sie zurück.
       */
      sorter: (a, b) => a.text.localeCompare(b.text, 'de', { numeric: true }),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            width: 120,
            /**
             * Die einzige UNUMKEHRBARE Aktion der Stammdaten (LFH-363 · B5c): jede andere
             * destruktive Aktion heißt „Außer Dienst"/„Deaktivieren" und trägt ihre
             * Umkehrung als Knopf daneben. Deshalb — und nur deshalb — steht hier eine
             * Rückfrage, die dort keine wäre, sondern eine Reibung ohne Gegenwert.
             * Ein Abstand ist hier nichts zu trennen: die Zelle trägt nur diese eine Aktion.
             */
            render: (_, v: StichwortVorschlag) => (
              <Popconfirm
                title="Stichwort löschen?"
                okText="Ja"
                cancelText="Abbrechen"
                okButtonProps={{ danger: true }}
                onConfirm={() => loeschenMutation.mutate(v.id)}
              >
                {/* Der Lauf gehört GENAU der gelöschten Zeile (LFH-346 · A1): am blanken
                    `isPending` drehte der Spinner in JEDER Zeile und behauptete Fortschritt
                    an fremden Datensätzen. `variables` ist hier die nackte id. */}
                <Button danger loading={loeschenMutation.isPending && loeschenMutation.variables === v.id}>
                  Löschen
                </Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<StichwortVorschlag>)
      : []),
  ];

  return (
    <>
      <Typography.Paragraph type="secondary">
        Vorschläge für die Stichwort-Combobox im Einsatzdaten-Modul. Freie Eingabe bleibt im
        Einsatz unabhängig davon möglich.
      </Typography.Paragraph>

      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch keine Stichworte" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {vorschlaegeQuery.isError ? (
        <SeitenFehler
          text="Stichworte konnten nicht geladen werden"
          ursache={vorschlaegeQuery.error}
          onWiederholen={() => void vorschlaegeQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={vorschlaegeQuery.isLoading}
          dataSource={vorschlaege}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Stichworte' }}
          // Nur `text` hat einen Datenbezug — die Aktionsspalte ist render-only und trägt
          // zur Suche nichts bei (dokumentierte Grenze im Kopf von `KatalogTabelle`).
          // Der Platzhalter benennt deshalb genau dieses eine Feld.
          suche={{ platzhalter: 'Stichwort' }}
        />
      )}

      {istAdmin && (
        <Space.Compact style={{ marginTop: 12, width: '100%' }}>
          <Input
            value={neuerText}
            onChange={(e) => setNeuerText(e.target.value)}
            onPressEnter={hinzufuegen}
            placeholder="Neues Stichwort, z. B. H1Y"
          />
          <Button type="primary" loading={anlegenMutation.isPending} onClick={hinzufuegen}>
            Hinzufügen
          </Button>
        </Space.Compact>
      )}
    </>
  );
}
