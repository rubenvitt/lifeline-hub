import { App, Button, Popconfirm, Space } from 'antd';
import { Select } from '../components/Select';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EinsatzRolle, MitgliedAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { entferneMitglied, ladeMitglieder, setzeMitglied } from '../api/einsaetze';
import { listeBenutzer } from '../api/benutzer';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import KatalogTabelle from '../components/KatalogTabelle';
import SektionHeader from '../components/SektionHeader';

const ROLLEN: { value: EinsatzRolle; label: string }[] = [
  { value: 'einsatzleitung', label: 'Einsatzleitung' },
  { value: 'fuehrungspersonal', label: 'Führungspersonal' },
  { value: 'beobachter', label: 'Beobachter' },
];

interface Props {
  einsatzId: number;
  darfVerwalten: boolean;
}

export default function MitgliederAbschnitt({ einsatzId, darfVerwalten }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerBenutzer, setNeuerBenutzer] = useState<number | undefined>();
  const [neueRolle, setNeueRolle] = useState<EinsatzRolle>('fuehrungspersonal');

  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const benutzerQuery = useQuery({
    queryKey: globalKeys.benutzer(),
    queryFn: listeBenutzer,
    enabled: darfVerwalten,
  });

  const setzen = useMutation({
    mutationFn: (v: { benutzerId: number; rolle: EinsatzRolle }) =>
      setzeMitglied(einsatzId, v.benutzerId, v.rolle),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.mitglieder(einsatzId), liste);
      setNeuerBenutzer(undefined);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });
  const entfernen = useMutation({
    mutationFn: (benutzerId: number) => entferneMitglied(einsatzId, benutzerId),
    onSuccess: (liste) => qc.setQueryData(einsatzKeys.mitglieder(einsatzId), liste),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const mitglieder = mitgliederQuery.data ?? [];
  const mitgliedIds = new Set(mitglieder.map((m) => m.benutzer_id));
  const verfuegbar = (benutzerQuery.data ?? []).filter((b) => b.aktiv && !mitgliedIds.has(b.id));

  const spalten: ColumnsType<MitgliedAnzeige> = [
    { title: 'Name', dataIndex: 'anzeigename' },
    {
      title: 'Rolle',
      key: 'rolle',
      render: (_, m) => (
        <Select
          value={m.einsatz_rolle}
          disabled={!darfVerwalten}
          style={{ width: 170 }}
          options={ROLLEN}
          onChange={(rolle) => setzen.mutate({ benutzerId: m.benutzer_id, rolle })}
        />
      ),
    },
    {
      title: '',
      key: 'aktion',
      render: (_, m) =>
        darfVerwalten ? (
          <Popconfirm
            title="Mitglied entfernen?"
            okText="Ja"
            cancelText="Abbrechen"
            okButtonProps={{ danger: true }}
            onConfirm={() => entfernen.mutate(m.benutzer_id)}
          >
            <Button type="link" danger>
              Entfernen
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <section style={{ marginTop: 32 }}>
      <SektionHeader titel="Zugriff" dataUpdatedAt={mitgliederQuery.dataUpdatedAt} />
      {darfVerwalten && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="Benutzer …"
            style={{ width: 200 }}
            value={neuerBenutzer}
            options={verfuegbar.map((b) => ({ value: b.id, label: b.anzeigename }))}
            onChange={(v) => setNeuerBenutzer(v)}
            notFoundContent={
              benutzerQuery.error instanceof ApiError && benutzerQuery.error.status === 403
                ? 'Benutzerliste nur für Admins'
                : benutzerQuery.isError
                  ? 'Benutzerliste nicht verfügbar'
                  : undefined
            }
          />
          <Select value={neueRolle} style={{ width: 170 }} options={ROLLEN} onChange={setNeueRolle} />
          <Button
            type="primary"
            disabled={neuerBenutzer == null}
            loading={setzen.isPending}
            onClick={() =>
              neuerBenutzer != null && setzen.mutate({ benutzerId: neuerBenutzer, rolle: neueRolle })
            }
          >
            Hinzufügen
          </Button>
        </Space>
      )}
      <KatalogTabelle<MitgliedAnzeige>
        rowKey="benutzer_id"
        size="small"
        pagination={false}
        loading={mitgliederQuery.isLoading}
        columns={spalten}
        dataSource={mitglieder}
      />
    </section>
  );
}
