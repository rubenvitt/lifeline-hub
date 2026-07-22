import { App, Button, Card, Empty, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EinsatzAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { useAuth } from '../auth/AuthContext';
import { globalKeys } from '../api/queryKeys';

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
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });

  const anlegen = useMutation({
    mutationFn: (werte: { bezeichnung: string; stichwort?: string }) =>
      legeEinsatzAn(werte.bezeichnung, werte.stichwort),
    onSuccess: (neuerEinsatz) => {
      form.resetFields();
      setDialogOffen(false);
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      navigate(`/einsaetze/${neuerEinsatz.id}`);
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Einsatz konnte nicht angelegt werden'),
  });

  const aktive = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'aktiv');
  const abgeschlossene = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'abgeschlossen');

  const renderKarte = (e: EinsatzAnzeige, klein = false) => (
    <Card
      key={e.id}
      hoverable
      size={klein ? 'small' : 'medium'}
      title={e.bezeichnung}
      style={klein ? { opacity: 0.65 } : undefined}
      onClick={() => navigate(`/einsaetze/${e.id}`)}
    >
      <Space orientation="vertical">
        <Space>
          <Tag color={STATUS_FARBE[e.status]}>{e.status}</Tag>
          {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
        </Space>
        {e.stichwort && <Typography.Text type="secondary">{e.stichwort}</Typography.Text>}
      </Space>
    </Card>
  );

  const leer = aktive.length === 0 && abgeschlossene.length === 0;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ marginBottom: 16 }}>
        Einsätze
      </Typography.Title>

      {leer && !darfAnlegen && !isLoading ? (
        <Empty description="Keine Einsätze" />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {darfAnlegen && (
            <Button
              type="dashed"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => setDialogOffen(true)}
              style={{ height: '100%', width: '100%', minHeight: 120 }}
            >
              Neuer Einsatz
            </Button>
          )}
          {aktive.map((e: EinsatzAnzeige) => renderKarte(e))}
        </div>
      )}

      {abgeschlossene.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <Typography.Title level={5} type="secondary" style={{ marginBottom: 12 }}>
            Abgeschlossen
          </Typography.Title>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {abgeschlossene.map((e: EinsatzAnzeige) => renderKarte(e, true))}
          </div>
        </div>
      )}

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
