import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listePersonalStatus, type StatusEingabe,
} from '../api/personalStatus';
import type { PersonalStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import StatusTag from '../components/StatusTag';
import { statusKategorie } from '../theme/statusFarben';


interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  sortier: number;
}

export default function PersonalStatusTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<PersonalStatus | null>(null);

  const statusQuery = useQuery({ queryKey: globalKeys.personalStatus(), queryFn: listePersonalStatus });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: leerZuNull(werte.farbe),
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereStatus(bearbeite.id, daten) : legeStatusAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        kategorie: bearbeite.kategorie,
        farbe: bearbeite.farbe ?? undefined,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<PersonalStatus> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      /**
       * Leitspalte: an ihr sucht ein Mensch den Status. Kein `defaultSortOrder` — die
       * fachliche Reihenfolge ist `sortier` und kommt vom Server
       * (`src/personal/status_repo.rs:42` — `ORDER BY sortier, id`); sie bleibt der
       * Einstieg, das Alphabet ist ein Angebot.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      /**
       * Die Filterwerte kommen aus derselben Quelle wie die Anzeige (`theme/statusFarben`),
       * damit eine neue Kategorie nicht an zwei Stellen nachgetragen werden muss. Der
       * gefilterte Wert ist der DRAHTWERT (`nicht_verfuegbar`), der angezeigte Text sein
       * Label — genau deshalb ist die Kategorie hier ein Filter und steht nicht im
       * Suchplatzhalter: die Freitextsuche des Primitivs liest Rohwerte, „nicht verfügbar"
       * fände dort nichts.
       */
      filters: (Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
        text: statusKategorie[k].label,
        value: k,
      })),
      onFilter: (wert, s) => s.kategorie === wert,
      render: (k: StatusKategorie) => <StatusTag darstellung={statusKategorie[k]} />,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: PersonalStatus) => (
              <Space>
                <Button onClick={() => { setBearbeite(s); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Status deaktivieren?" onConfirm={() => deaktivieren.mutate(s.id)}>
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<PersonalStatus>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Status anlegen
        </Button>
      )}
      <KatalogTabelle
        rowKey="id"
        loading={statusQuery.isLoading}
        dataSource={statusQuery.data ?? []}
        columns={spalten}
        /**
         * Genannt wird nur das Label — die übrigen Spalten mit Datenbezug tragen zwar zur
         * Suche bei (Kategorie als Drahtwert, Farbe als Hexwert, Sortierung als Zahl), aber
         * nach keinem davon tippt jemand. Die Kategorie hat stattdessen ihren Trichter.
         */
        suche={{ platzhalter: 'Label' }}
        locale={{ emptyText: 'Kein Status' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Status bearbeiten' : 'Status anlegen'}
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setModalOffen(false)}
        destroyOnHidden
      >
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
                value: k, label: statusKategorie[k].label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
