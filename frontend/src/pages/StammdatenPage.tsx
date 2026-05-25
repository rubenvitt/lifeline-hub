import { App, Button, Input, List, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Platzhalter from '../components/Platzhalter';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
} from '../api/stichwortVorschlaege';

export default function StammdatenPage() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerText, setNeuerText] = useState('');

  const vorschlaegeQuery = useQuery({
    queryKey: ['stichwort-vorschlaege'],
    queryFn: listeStichwortVorschlaege,
  });

  const anlegenMutation = useMutation({
    mutationFn: (text: string) => legeStichwortVorschlagAn(text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] });
      setNeuerText('');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Hinzufügen fehlgeschlagen'),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] }),
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  function hinzufuegen() {
    const text = neuerText.trim();
    if (text) anlegenMutation.mutate(text);
  }

  const vorschlaege = vorschlaegeQuery.data ?? [];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3}>Stammdaten</Typography.Title>

      <Typography.Title level={4}>Einsatz-Stichworte</Typography.Title>
      <Typography.Paragraph type="secondary">
        Vorschläge für die Stichwort-Combobox im Einsatzdaten-Modul. Freie Eingabe bleibt im
        Einsatz unabhängig davon möglich.
      </Typography.Paragraph>

      <List
        bordered
        dataSource={vorschlaege}
        locale={{ emptyText: 'Noch keine Stichworte' }}
        renderItem={(v) => (
          <List.Item
            actions={
              istAdmin
                ? [
                    <Button
                      key="del"
                      danger
                      size="small"
                      loading={loeschenMutation.isPending}
                      onClick={() => loeschenMutation.mutate(v.id)}
                    >
                      Löschen
                    </Button>,
                  ]
                : []
            }
          >
            {v.text}
          </List.Item>
        )}
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

      <div style={{ marginTop: 32 }}>
        <Platzhalter
          titel="Weitere Stammdaten"
          beschreibung="Personal, Fahrzeuge und Einheiten folgen in späteren Modulen."
        />
      </div>
    </div>
  );
}
