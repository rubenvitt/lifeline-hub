import { Col, DatePicker, Input, InputNumber, Form, Row } from 'antd';
import { Paneel } from '../components/instrument';
import dayjs, { type Dayjs } from 'dayjs';
import { ErfassungsFormular } from '../components/Erfassung';
import type { NeueErinnerung } from '../api/types';

const { TextArea } = Input;

/// Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss' (rein, testbar).
export function dayjsZuWire(d: Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

/** Werte des Formulars (lokale Picker-Zeit vor der UTC-Wandlung). */
interface FormWerte {
  titel: string;
  beschreibung: string;
  faellig: Dayjs | null;
  intervall: number | null;
  empfaenger: string;
}

/** Wiederholfelder einer Serie: meist dieselbe Funktion im selben Takt; der Anlass wechselt. */
const UEBERNAHME: (keyof FormWerte & string)[] = ['empfaenger', 'intervall'];

interface Props {
  senden: boolean;
  /**
   * Anlegen. **Muss bei Ablehnung ablehnen** (`mutateAsync`) — nur dann lässt die
   * Erfassungshülle die Eingabe stehen.
   */
  onAnlegen: (daten: NeueErinnerung) => Promise<unknown>;
  /** Umschließendes Paneel mit Titel rendern. `false`, wo der Container den Titel schon liefert. */
  card?: boolean;
}

export default function ErinnerungFormular({ senden, onAnlegen, card = true }: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Das `return` ist tragend: die Hülle lässt die Felder stehen, wenn die Zusage bricht.
  const absenden = (w: FormWerte) => {
    // Typ-Guard (die Pflicht-Rule deckt es ab). Ablehnen statt zurückkehren, sonst räumte die
    // Hülle ein Formular, das nichts gespeichert hat.
    if (!w.faellig) return Promise.reject(new Error('Keine Fälligkeit'));
    return onAnlegen({
      titel: w.titel.trim(),
      beschreibung: w.beschreibung?.trim() || undefined,
      faellig_at: dayjsZuWire(w.faellig),
      intervall_minuten: w.intervall ?? undefined,
      empfaenger_funktion: w.empfaenger?.trim() || undefined,
    });
  };

  const formular = (
    <ErfassungsFormular<FormWerte>
      form={form}
      initialValues={{
        titel: '',
        beschreibung: '',
        faellig: dayjs(),
        intervall: null,
        empfaenger: '',
      }}
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Anlegen NICHT — Zuklappen ist ausdrückliche Nutzeraktion.
      onFertig={() => {}}
      laeuft={senden}
      erfassenText="Anlegen"
      serie
      uebernahme={UEBERNAHME}
    >
      <Form.Item
        name="titel"
        label="Titel / Anlass"
        rules={[{ required: true, message: 'Titel ist erforderlich' }]}
      >
        <Input aria-label="Titel" placeholder="z. B. Lagemeldung aller EA" />
      </Form.Item>
      <Form.Item name="beschreibung" label="Beschreibung (optional)">
        <TextArea aria-label="Beschreibung" rows={2} />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="faellig"
            label="Fällig"
            rules={[{ required: true, message: 'Fälligkeit ist erforderlich' }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="intervall" label="Intervall (Min, optional)">
            <InputNumber
              aria-label="Intervall"
              min={1}
              placeholder="30"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="empfaenger" label="Empfänger/Funktion (optional)">
        <Input aria-label="Empfänger" />
      </Form.Item>
    </ErfassungsFormular>
  );

  if (!card) return formular;
  return (
    <Paneel titel="Neue Erinnerung" koerperPolster>
      {formular}
    </Paneel>
  );
}
