import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import AdminPage from '../components/AdminPage';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { deaktiviereBenutzer, legeBenutzerAn, listeBenutzer, type NeuerBenutzer } from '../api/benutzer';
import { useAuth } from '../auth/AuthContext';

const SYSTEM_ROLLEN = [
  { value: 'keiner', label: 'Benutzer' },
  { value: 'admin', label: 'Admin' },
];
const ORG_ROLLEN = [
  { value: 'keine', label: 'Keine' },
  { value: 'fuehrungskraft', label: 'Führungskraft (darf Einsätze anlegen)' },
];

export default function BenutzerPage() {
  const { benutzer: angemeldeterBenutzer, laedt: authLaedt } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<NeuerBenutzer>();

  const { data: benutzerListe = [], isLoading } = useQuery({
    queryKey: ['benutzer'],
    queryFn: listeBenutzer,
  });

  const anlegen = useMutation({
    mutationFn: (b: NeuerBenutzer) => legeBenutzerAn(b),
    onSuccess: () => {
      setOffen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['benutzer'] });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBenutzer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['benutzer'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  if (!authLaedt && angemeldeterBenutzer?.system_rolle !== 'admin') {
    return <Navigate to="/einsaetze" replace />;
  }

  return (
    <AdminPage
      titel="Benutzer"
      beschreibung="System- und Org-Rollen der Benutzerkonten verwalten."
      aktionen={
        <Button type="primary" onClick={() => setOffen(true)}>
          Benutzer anlegen
        </Button>
      }
    >
      <Liste
        loading={isLoading}
        bordered
        rowKey={(b) => b.id}
        dataSource={benutzerListe}
        renderItem={(b: BenutzerAnzeige) => (
          <ListenEintrag
            actions={
              b.aktiv
                ? [
                    <Popconfirm
                      key="deaktivieren"
                      title="Benutzer deaktivieren?"
                      okText="Ja"
                      cancelText="Abbrechen"
                      onConfirm={() => deaktivieren.mutate(b.id)}
                    >
                      <Button type="link" danger size="small">
                        Deaktivieren
                      </Button>
                    </Popconfirm>,
                  ]
                : []
            }
          >
            <ListenEintragMeta
              title={b.anzeigename}
              description={
                <Space>
                  <span>@{b.benutzername}</span>
                  {b.system_rolle === 'admin' && <Tag color="gold">Admin</Tag>}
                  {b.org_rolle === 'fuehrungskraft' && <Tag color="blue">Führungskraft</Tag>}
                  {!b.aktiv && <Tag>deaktiviert</Tag>}
                </Space>
              }
            />
          </ListenEintrag>
        )}
      />

      <Modal
        title="Neuen Benutzer anlegen"
        open={offen}
        onCancel={() => {
          setOffen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="Anlegen"
        confirmLoading={anlegen.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ system_rolle: 'keiner', org_rolle: 'keine' }}
          onFinish={(w) => anlegen.mutate(w)}
        >
          <Form.Item
            label="Anzeigename"
            name="anzeigename"
            rules={[{ required: true, message: 'Bitte Anzeigename eingeben' }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            label="Benutzername"
            name="benutzername"
            rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="Passwort"
            name="passwort"
            rules={[{ required: true, min: 8, message: 'Mindestens 8 Zeichen' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="System-Rolle" name="system_rolle">
            <Select options={SYSTEM_ROLLEN} />
          </Form.Item>
          <Form.Item label="Org-Rolle" name="org_rolle">
            <Select options={ORG_ROLLEN} />
          </Form.Item>
        </Form>
      </Modal>
    </AdminPage>
  );
}
