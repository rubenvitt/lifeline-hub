import { Form, Input } from 'antd';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';

interface KanalFormWerte {
  name: string;
  beschreibung?: string;
}

interface Props {
  offen: boolean;
  /** Setzt nur den Offen-Zustand des Aufrufers; die Hülle leert die Felder selbst. */
  onSchliessen: () => void;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); dann bleibt der Dialog mit den Eingaben offen. */
  onKanalAnlegen: (name: string, beschreibung?: string) => Promise<unknown>;
  /**
   * Die Speicher-Mutation (LFH-1077), an die Erfassungshülle durchgereicht: ihr Grund steht im
   * Dialog, bis zum nächsten Absenden; Öffnen und Abbrechen räumen ihn.
   */
  speicherung?: Speicherung;
}

/**
 * Anlage eines Chat-Kanals über die `ErfassungsModal`-Hülle. Eine Stelle für beide Zugänge
 * (LFH-976): die Kopfaktion der `KanalListe` ab `md` und der Knopf neben der Kanal-Leiste
 * darunter. Name und Beschreibung kommen getrimmt an, eine leere Beschreibung als `undefined`.
 */
export default function KanalAnlegenDialog({
  offen,
  onSchliessen,
  onKanalAnlegen,
  speicherung,
}: Props) {
  const [form] = Form.useForm<KanalFormWerte>();
  return (
    <ErfassungsModal<KanalFormWerte>
      offen={offen}
      titel="Neuer Kanal"
      form={form}
      erfassenText="Anlegen"
      laeuft={speicherung?.isPending}
      speicherung={speicherung}
      speicherFehlerTitel="Kanal nicht angelegt"
      speicherFehlerFallback="Anlegen fehlgeschlagen"
      onErfassen={(w) => onKanalAnlegen(w.name.trim(), w.beschreibung?.trim() || undefined)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Name"
        name="name"
        rules={[{ required: true, whitespace: true, message: 'Name erforderlich' }]}
      >
        <Input placeholder="z. B. S2/S3 oder Abschnitt Nord" />
      </Form.Item>
      <Form.Item label="Beschreibung (optional)" name="beschreibung">
        <Input placeholder="Kurzbeschreibung" />
      </Form.Item>
    </ErfassungsModal>
  );
}
