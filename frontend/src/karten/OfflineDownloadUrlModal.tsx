import { App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { starteOfflineDownload } from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';

interface FormWerte {
  name: string;
  url: string;
  lizenz: string;
}

/** Loopback-Hosts: der Server lässt sie nur im Dev-Betrieb zu und entscheidet selbst. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$|\.localhost$/i;

/**
 * Prüft, was früher ein Erklärkasten beschrieb (LFH-1078): eine https-Adresse. Nicht strenger
 * als der Server (`src/karte/download.rs`, `url_ist_sicher_mit`): Loopback lässt die Maske
 * durch, weil der Server sie im Dev-Betrieb annimmt; eine Dateiendung verlangt er nicht, weil
 * Download-Links oft keine tragen. Interne Adressen weist der Server ab, seine Meldung steht
 * dann in der Maske.
 */
export function downloadUrlFehler(url: string): string | null {
  let adresse: URL;
  try {
    adresse = new URL(url.trim());
  } catch {
    return 'Keine gültige Adresse';
  }
  if (adresse.protocol === 'https:' || LOOPBACK.test(adresse.hostname)) return null;
  return 'Nur https-Adressen';
}

/**
 * Schnellerfassung für einen Offline-Download per eigener URL (selbst gebaute/gehostete
 * MBTiles-Extrakte). `lizenz` ist Pflicht (Server erzwingt es; offline sichtbar). v1:
 * Kachelschema fest `shortbread`. Zurückgesetzt wird von `ErfassungsModal` auf allen Auswegen.
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
    // Das Schließen macht `onFertig`. Die Erfolgsmeldung quittiert einen Vorgang, der im
    // Hintergrund weiterläuft; eine Ablehnung zeigt die Hülle im Dialog (`speicherung`), kein
    // Toast (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077).
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Download gestartet');
    },
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Per URL herunterladen"
      form={form}
      erfassenText="Download starten"
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Download nicht gestartet"
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen.
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Name"
        name="name"
        rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. Deutschland (eigener Extrakt)" />
      </Form.Item>
      <Form.Item
        label="URL (.mbtiles)"
        name="url"
        rules={[
          { required: true, whitespace: true, message: 'URL darf nicht leer sein' },
          {
            validator: (_, wert?: string) => {
              const fehler = wert?.trim() ? downloadUrlFehler(wert) : null;
              return fehler ? Promise.reject(new Error(fehler)) : Promise.resolve();
            },
          },
        ]}
      >
        <Input placeholder="https://…/de.mbtiles" />
      </Form.Item>
      <Form.Item
        label="Attribution / Lizenz"
        name="lizenz"
        rules={[{ required: true, whitespace: true, message: 'Attribution ist Pflicht' }]}
      >
        <Input.TextArea rows={2} placeholder="© OpenStreetMap contributors (ODbL)" />
      </Form.Item>
    </ErfassungsModal>
  );
}
