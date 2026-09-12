import { Alert, App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
import { starteOfflineDownload } from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';

interface FormWerte {
  name: string;
  url: string;
  lizenz: string;
}

/**
 * Schlanke Schnellerfassung für einen Offline-Download per eigener URL (CLAUDE.md-Leitlinie:
 * kurzes Formular ≤~3 Felder → Modal). Für selbst gebaute/gehostete MBTiles-Extrakte. `lizenz`
 * ist Pflicht (Server erzwingt es; offline sichtbar). v1: Shortbread-Schema fest.
 *
 * Der frühere `resetFields()`-Effekt beim Öffnen ist weg (LFH-346/A6): `ErfassungsModal`
 * setzt auf allen vier Auswegen selbst zurück, ein zweiter Reset verdeckte nur, ob die
 * Hülle ihre Zusicherung einlöst.
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

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) =>
      starteOfflineDownload({
        name: werte.name.trim(),
        url: werte.url.trim(),
        lizenz: werte.lizenz.trim(),
        kachel_schema: 'shortbread',
      }),
    // Kein `onClose()` mehr: das Schliessen macht `onFertig`. Die Erfolgsmeldung bleibt —
    // sie ist die Quittung für einen Vorgang, der im Hintergrund weiterläuft.
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Download gestartet');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Download fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Per URL herunterladen"
      form={form}
      erfassenText="Download starten"
      laeuft={mutation.isPending}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332).
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="MBTiles im Shortbread-Schema"
        description={
          'Die URL muss auf eine herunterladbare .mbtiles-Datei (Shortbread-Schema) zeigen — nur ' +
          'https, keine internen Adressen. Wird in der Prep-Phase (mit Netz) geladen und im Feld ' +
          'offline ausgeliefert.'
        }
      />
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
        <Input placeholder="https://…/de.mbtiles" />
      </Form.Item>
      <Form.Item
        label="Attribution / Lizenz"
        name="lizenz"
        tooltip="Pflichtangabe — wird offline auf der Karte angezeigt (rechtlich erforderlich)."
        rules={[{ required: true, whitespace: true, message: 'Attribution ist Pflicht' }]}
      >
        <Input.TextArea rows={2} placeholder="© OpenStreetMap contributors (ODbL)" />
      </Form.Item>
    </ErfassungsModal>
  );
}
