import { App, Button, Input, Space, Typography, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
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
            render: (_, v: StichwortVorschlag) => (
              <Button
                danger
                size="small"
                loading={loeschenMutation.isPending}
                onClick={() => loeschenMutation.mutate(v.id)}
              >
                Löschen
              </Button>
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
