import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, type TableColumnsType,
} from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereTyp, deaktiviereTyp, legeTypAn, listeEinheitTypen, type TypEingabe,
} from '../api/einheitTypen';
import type { EinheitTyp } from '../api/types';

interface FormWerte {
  label: string;
  soll_fuehrer?: number;
  soll_unterfuehrer?: number;
  soll_mannschaft?: number;
  sortier: number;
}

/** "F/UF/M/Gesamt" oder "—", wenn keine Soll-Stärke definiert ist. */
function sollAnzeige(t: EinheitTyp): string {
  if (!t.soll) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = t.soll;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}/${fuehrer + unterfuehrer + mannschaft}`;
}

export default function EinheitTypenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EinheitTyp | null>(null);

  const typenQuery = useQuery({ queryKey: ['einheit-typen'], queryFn: listeEinheitTypen });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: TypEingabe = {
        label: werte.label.trim(),
        soll_fuehrer: werte.soll_fuehrer ?? null,
        soll_unterfuehrer: werte.soll_unterfuehrer ?? null,
        soll_mannschaft: werte.soll_mannschaft ?? null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereTyp(bearbeite.id, daten) : legeTypAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['einheit-typen'] }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereTyp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['einheit-typen'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        soll_fuehrer: bearbeite.soll?.fuehrer,
        soll_unterfuehrer: bearbeite.soll?.unterfuehrer,
        soll_mannschaft: bearbeite.soll?.mannschaft,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<EinheitTyp> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    { title: 'Soll-Stärke (F/UF/M/Σ)', key: 'soll', render: (_, t) => sollAnzeige(t) },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, t: EinheitTyp) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(t); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Typ deaktivieren?" onConfirm={() => deaktivieren.mutate(t.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EinheitTyp>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Typ anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={typenQuery.isLoading}
        dataSource={typenQuery.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Kein Einheitstyp' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Typ bearbeiten' : 'Typ anlegen'}
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setModalOffen(false)}
        destroyOnHidden
      >
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Zug" />
          </Form.Item>
          <Form.Item label="Soll-Stärke (vollständig oder leer lassen)">
            <Space>
              <Form.Item name="soll_fuehrer" noStyle><InputNumber min={0} placeholder="Führer" /></Form.Item>
              <Form.Item name="soll_unterfuehrer" noStyle><InputNumber min={0} placeholder="Unterführer" /></Form.Item>
              <Form.Item name="soll_mannschaft" noStyle><InputNumber min={0} placeholder="Mannschaft" /></Form.Item>
            </Space>
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
