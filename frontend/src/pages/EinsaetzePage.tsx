import { App, Button, Form, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EinsatzAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { useAuth } from '../auth/AuthContext';

const STATUS_FARBE: Record<string, string> = { aktiv: 'green', abgeschlossen: 'default' };

export default function EinsaetzePage() {
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form] = Form.useForm<{ bezeichnung: string; stichwort?: string }>();

  const darfAnlegen = benutzer?.system_rolle === 'admin' || benutzer?.org_rolle === 'fuehrungskraft';

  const { data: einsaetze = [], isLoading } = useQuery({
    queryKey: ['einsaetze'],
    queryFn: listeEinsaetze,
  });

  const anlegen = useMutation({
    mutationFn: (werte: { bezeichnung: string; stichwort?: string }) =>
      legeEinsatzAn(werte.bezeichnung, werte.stichwort),
    onSuccess: () => {
      form.resetFields();
      setDialogOffen(false);
      qc.invalidateQueries({ queryKey: ['einsaetze'] });
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Einsatz konnte nicht angelegt werden'),
  });

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Einsätze
        </Typography.Title>
        {darfAnlegen && (
          <Button type="primary" onClick={() => setDialogOffen(true)}>
            Einsatz anlegen
          </Button>
        )}
      </Space>

      <List
        loading={isLoading}
        bordered
        dataSource={einsaetze}
        locale={{ emptyText: 'Keine Einsätze' }}
        renderItem={(e: EinsatzAnzeige) => (
          <List.Item
            actions={[
              <Button key="oeffnen" type="link" onClick={() => navigate(`/einsaetze/${e.id}/etb`)}>
                Öffnen
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={e.bezeichnung}
              description={
                <Space>
                  <Tag color={STATUS_FARBE[e.status]}>{e.status}</Tag>
                  {e.stichwort && <span>{e.stichwort}</span>}
                  {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <Modal
        title="Neuen Einsatz anlegen"
        open={dialogOffen}
        onCancel={() => {
          setDialogOffen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="Anlegen"
        confirmLoading={anlegen.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(w) => anlegen.mutate(w)}>
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, message: 'Bitte Bezeichnung eingeben' }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Stichwort" name="stichwort">
            <Input placeholder="optional, z.B. THW / RD" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
