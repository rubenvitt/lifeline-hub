import { Alert, App, Form, Input, Modal } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { starteOfflineDownload } from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';

interface FormWerte {
  name: string;
  url: string;
  lizenz: string;
}

/**
 * Schlanke Schnellerfassung für einen Offline-Download per eigener URL (CLAUDE.md-Leitlinie:
 * kurzes Formular ≤~3 Felder → Modal). Für selbst gebaute/gehostete PMTiles-Extrakte. `lizenz`
 * ist Pflicht (Server erzwingt es; offline sichtbar). v1: Protomaps-Schema fest.
 */
export default function OfflineDownloadUrlModal({
  offen,
  onClose,
}: {
  offen: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (offen) form.resetFields();
  }, [offen, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) =>
      starteOfflineDownload({
        name: werte.name.trim(),
        url: werte.url.trim(),
        lizenz: werte.lizenz.trim(),
        kachel_schema: 'protomaps',
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Download gestartet');
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Download fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title="Per URL herunterladen"
      okText="Download starten"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="PMTiles im Protomaps-Schema"
        description={
          'Die URL muss auf eine herunterladbare .pmtiles-Datei (Protomaps-Schema) zeigen — nur ' +
          'https, keine internen Adressen. Wird in der Prep-Phase (mit Netz) geladen und im Feld ' +
          'offline ausgeliefert.'
        }
      />
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
        >
          <Input placeholder="z. B. Deutschland (eigener Extrakt)" />
        </Form.Item>
        <Form.Item
          label="URL"
          name="url"
          rules={[{ required: true, whitespace: true, message: 'URL darf nicht leer sein' }]}
        >
          <Input placeholder="https://…/de.pmtiles" />
        </Form.Item>
        <Form.Item
          label="Attribution / Lizenz"
          name="lizenz"
          tooltip="Pflichtangabe — wird offline auf der Karte angezeigt (rechtlich erforderlich)."
          rules={[{ required: true, whitespace: true, message: 'Attribution ist Pflicht' }]}
        >
          <Input.TextArea rows={2} placeholder="© OpenStreetMap contributors (ODbL)" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
