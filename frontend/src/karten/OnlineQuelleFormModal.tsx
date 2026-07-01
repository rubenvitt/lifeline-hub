import { Alert, App, Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import type { OnlineStyleTyp } from '../api/karte';
import {
  aktualisiereOnlineQuelle,
  legeOnlineQuelleAn,
  type OnlineQuelle,
  type OnlineQuelleBody,
} from '../api/onlineQuellen';
import { invalidiereKarte } from './invalidiereKarte';

interface FormWerte {
  name: string;
  url: string;
  typ: OnlineStyleTyp;
  attribution: string;
  sortier: number;
  aktiv: boolean;
  proxy: boolean;
}

const TYP_OPTIONEN: { value: OnlineStyleTyp; label: string }[] = [
  { value: 'vektor', label: 'Vektor (Style-JSON)' },
  { value: 'raster', label: 'Raster (XYZ-Kacheln)' },
];

const URL_PLATZHALTER: Record<OnlineStyleTyp, string> = {
  vektor: 'https://…/style.json',
  raster: 'https://…/{z}/{x}/{y}.png',
};

/**
 * Schlanke Schnellerfassung/Bearbeitung einer Online-Quelle als Form-in-Modal
 * (CLAUDE.md-Leitlinie: kurzes Formular ≤~6 Felder → Modal, kein Drawer).
 * `attribution` ist required (Server erzwingt es). Statischer Hinweis warnt vor
 * schlüsselbasierten Anbietern (Secret gehört nicht ins Frontend → LFH-182).
 */
export default function OnlineQuelleFormModal({
  offen,
  quelle,
  naechsteSortier,
  onClose,
}: {
  offen: boolean;
  quelle: OnlineQuelle | null; // null = neu
  naechsteSortier: number;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const typ = Form.useWatch('typ', form) ?? 'vektor';

  useEffect(() => {
    if (!offen) return;
    if (quelle) {
      form.setFieldsValue({
        name: quelle.name,
        url: quelle.url,
        typ: quelle.typ,
        attribution: quelle.attribution ?? '',
        sortier: quelle.sortier,
        aktiv: quelle.aktiv,
        proxy: quelle.proxy,
      });
    } else {
      form.resetFields();
      // LFH-190: Proxy ist Default-an (key-frei + serverseitig gecacht).
      form.setFieldsValue({ typ: 'vektor', sortier: naechsteSortier, aktiv: true, proxy: true });
    }
  }, [offen, quelle, naechsteSortier, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const body: OnlineQuelleBody = {
        name: werte.name.trim(),
        url: werte.url.trim(),
        typ: werte.typ,
        attribution: werte.attribution.trim(),
        sortier: werte.sortier ?? 0,
        aktiv: werte.aktiv ?? true,
        // Default-an (LFH-190).
        proxy: werte.proxy ?? true,
      };
      return quelle ? aktualisiereOnlineQuelle(quelle.id, body) : legeOnlineQuelleAn(body);
    },
    onSuccess: () => {
      invalidiereKarte(qc);
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={quelle ? 'Online-Quelle bearbeiten' : 'Online-Quelle hinzufügen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="Über Server proxen (Standard)"
        description={
          'Empfohlen: Der Server holt Style/Tiles/Sprite/Glyphs und speichert sie zwischen — ' +
          'Schlüssel bleiben server-seitig (erscheinen nie im Browser) und gleiche Kacheln treffen ' +
          'den Anbieter nur einmal. Für key-basierte Anbieter (z. B. MapTiler, Stadia) die volle ' +
          'URL inkl. Schlüssel eintragen. Proxy nur abschalten, wenn der Anbieter Proxying/Caching ' +
          'untersagt (z. B. OSM-Standard-Tiles) — dann läuft die URL direkt im Browser.'
        }
      />
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
        >
          <Input placeholder="z. B. OpenStreetMap" />
        </Form.Item>
        <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ wählen' }]}>
          <Select options={TYP_OPTIONEN} />
        </Form.Item>
        <Form.Item
          label="URL"
          name="url"
          rules={[{ required: true, whitespace: true, message: 'URL darf nicht leer sein' }]}
        >
          <Input placeholder={URL_PLATZHALTER[typ]} />
        </Form.Item>
        <Form.Item
          label="Attribution"
          name="attribution"
          tooltip="Pflichtangabe — Urheber/Lizenz der Kartendaten (rechtlich erforderlich)."
          rules={[{ required: true, whitespace: true, message: 'Attribution ist Pflicht' }]}
        >
          <Input.TextArea rows={2} placeholder="© OpenStreetMap-Mitwirkende" />
        </Form.Item>
        <Form.Item
          label="Sortierung"
          name="sortier"
          tooltip="Reihenfolge im Basemap-Switcher (kleiner = weiter oben)."
        >
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          label="Aktiv"
          name="aktiv"
          valuePropName="checked"
          tooltip="Nur aktive Quellen erscheinen im Basemap-Switcher der Lagekarte."
        >
          <Switch />
        </Form.Item>
        <Form.Item
          label="Über Server proxen"
          name="proxy"
          valuePropName="checked"
          tooltip="Standard an: Server holt Style/Tiles/Sprite/Glyphs, hält Schlüssel server-seitig und cacht die Antworten (LFH-182/190). Abschalten nur, wenn der Anbieter Proxying/Caching untersagt."
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
