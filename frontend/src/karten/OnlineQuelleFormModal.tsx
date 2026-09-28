import { App, Collapse, Form, Input, InputNumber, Switch } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
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
 * Schnellerfassung/Bearbeitung einer Online-Quelle als Form-in-Modal.
 *
 * Feldbudget: sichtbar sind die VIER Pflichtwerte — Name, Typ, URL und Attribution —,
 * eingeklappt Sortierung, Aktiv und Proxy. `attribution` ist Pflicht, serverseitig erzwungen
 * und ohne brauchbare Vorgabe (Urheber und Lizenz je Quelle verschieden); hinter dem Collapse
 * käme eine Ablehnung von einem unsichtbaren Feld.
 *
 * Der Proxy-Schalter wird per `tooltip` an seinem `Form.Item` erklärt, der URL-Hinweis
 * (Schlüssel gehört in die URL, nicht ins Frontend) hängt am URL-Feld.
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

  // Vorbelegung, kein Zurücksetzen (siehe `FahrzeugFormModal`). Die Anlegen-Vorgaben stehen als
  // `initialValues` an der Hülle, jedes `resetFields` holt sie wieder — inklusive der aktuellen
  // `naechsteSortier`.
  useEffect(() => {
    if (!offen || !quelle) return;
    form.setFieldsValue({
      name: quelle.name,
      url: quelle.url,
      typ: quelle.typ,
      attribution: quelle.attribution ?? '',
      sortier: quelle.sortier,
      aktiv: quelle.aktiv,
      proxy: quelle.proxy,
    });
  }, [offen, quelle, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const body: OnlineQuelleBody = {
        name: werte.name.trim(),
        url: werte.url.trim(),
        typ: werte.typ,
        attribution: werte.attribution.trim(),
        sortier: werte.sortier ?? 0,
        aktiv: werte.aktiv ?? true,
        // Default-an.
        proxy: werte.proxy ?? true,
      };
      return quelle ? aktualisiereOnlineQuelle(quelle.id, body) : legeOnlineQuelleAn(body);
    },
    // Das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => {
      invalidiereKarte(qc);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={quelle ? 'Online-Quelle bearbeiten' : 'Online-Quelle hinzufügen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // Proxy ist Default-an (key-frei + serverseitig gecacht).
      initialValues={{ typ: 'vektor', sortier: naechsteSortier, aktiv: true, proxy: true }}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen.
      //
      // Der Formularspeicher statt der `onFinish`-Werte: ohne `forceRender` sind Sortierung, Aktiv
      // und Proxy nicht montiert, und `onFinish` liefert nur montierte Felder. `OnlineQuelleBody` ist
      // Vollersatz — eine Quelle fiele sonst beim Speichern auf Sortierung 0 und den Vorgabe-Proxy
      // zurück. Ein Rückfall auf `quelle?.proxy` unterschiede „nie montiert" nicht von „bewusst
      // umgelegt".
      // `getFieldsValue(true)` ist `any`-typisiert; die Feldnamen prüft der Parametertyp von
      // `mutationFn`.
      onErfassen={() => mutation.mutateAsync(form.getFieldsValue(true))}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
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
        tooltip={
          'Bei schlüsselbasierten Anbietern (z. B. MapTiler, Stadia) die volle URL ' +
          'inklusive Schlüssel eintragen — mit eingeschaltetem Proxy bleibt er ' +
          'server-seitig und erscheint nie im Browser (LFH-182).'
        }
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
      {/* Bewusst OHNE `forceRender`: nur so ist „im Ausgangszustand vier Felder" prüfbar; das
         Gegenmittel steht am `onErfassen` oben. */}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                <Form.Item
                  label="Sortierung"
                  name="sortier"
                  tooltip="Reihenfolge im Basemap-Switcher (kleiner = weiter oben)."
                >
                  <InputNumber min={0} style={{ width: '100%', maxWidth: 160 }} />
                </Form.Item>
                <Form.Item
                  label="Aktiv"
                  name="aktiv"
                  valuePropName="checked"
                  tooltip="Nur aktive Quellen erscheinen im Basemap-Switcher der Lagekarte."
                >
                  <Switch />
                </Form.Item>
                {/* Ein Alert erklärt einen Zustand der Seite, ein Tooltip ein Feld. */}
                <Form.Item
                  label="Über Server proxen"
                  name="proxy"
                  valuePropName="checked"
                  tooltip={
                    'Standard an (empfohlen): Der Server holt Style, Tiles, Sprite und Glyphs, ' +
                    'hält Schlüssel server-seitig und speichert die Antworten zwischen — ' +
                    'gleiche Kacheln treffen den Anbieter nur einmal (LFH-182/190). ' +
                    'Abschalten nur, wenn der Anbieter Proxying oder Caching untersagt ' +
                    '(z. B. OSM-Standard-Tiles); dann läuft die URL direkt im Browser.'
                  }
                >
                  <Switch />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
