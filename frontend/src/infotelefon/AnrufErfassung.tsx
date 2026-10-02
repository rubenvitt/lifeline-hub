import { Button, Checkbox, Collapse, Flex, Form, Input } from 'antd';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import type { RefSelectProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useRef, useState } from 'react';
import type { InfotelefonAnliegen } from '../api/types';
import type { AnrufEingabe } from '../api/infotelefon';
import { Schnellerfassungszeile, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useViewport } from '../components/useViewport';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { ANLIEGEN_LABEL, ANLIEGEN_REIHENFOLGE } from '../presse/labels';

/**
 * Schnellerfassung des Informationstelefons (LFH-554, Spec `stab-infotelefon`): am Fuß der Seite,
 * für Serienbetrieb am Bürgertelefon.
 *
 * - Sichtbar: Anliegen, Notiz, „Rückruf nötig“. Name, Rückrufnummer und Uhrzeit liegen
 *   eingeklappt — außer die Rückrufnummer wird Pflicht: dann steht sie offen da, denn ein
 *   Pflichtfeld gehört nie hinter die Einklappung (Erfassungs-Norm).
 * - Absende-Knopf im `<form>`, deshalb sendet Enter. Nach dem Speichern sind die Felder leer und
 *   der Fokus steht wieder im Anliegen (`requestAnimationFrame`). „Werte behalten“ gibt es nicht:
 *   jeder Anruf ist ein neuer.
 * - Scheitert das Speichern, bleiben die Felder stehen und der Grund steht darüber.
 */
interface Werte {
  anliegen?: InfotelefonAnliegen;
  notiz?: string;
  rueckruf_noetig?: boolean;
  anrufer_name?: string;
  rueckruf?: string;
  eingang?: Dayjs;
}

export const TASTATURVERTRAG = 'Enter speichert · Tab wechselt das Feld';

export default function AnrufErfassung({
  onErfassen,
  laeuft,
  fehler,
}: {
  onErfassen: (eingabe: AnrufEingabe) => Promise<unknown>;
  laeuft: boolean;
  fehler: unknown;
}) {
  const [form] = Form.useForm<Werte>();
  const { token } = useRollen();
  const { istSchmal } = useViewport();
  const anliegenRef = useRef<RefSelectProps>(null);
  const sendetRef = useRef(false);
  const [gespeichert, setGespeichert] = useState(0);
  const rueckrufNoetig = Form.useWatch('rueckruf_noetig', form) === true;

  const absenden = async (w: Werte) => {
    if (sendetRef.current || !w.anliegen) return;
    sendetRef.current = true;
    try {
      await onErfassen({
        anliegen: w.anliegen,
        notiz: w.notiz,
        anrufer_name: w.anrufer_name,
        rueckruf: w.rueckruf,
        rueckruf_noetig: w.rueckruf_noetig === true,
        ...(w.eingang ? { eingang_at: alsBackendZeit(w.eingang) } : {}),
      });
      form.resetFields();
      setGespeichert((n) => n + 1);
      requestAnimationFrame(() => anliegenRef.current?.focus());
    } catch {
      // Der Grund steht als `fehler` über der Zeile; die Felder bleiben stehen.
    } finally {
      sendetRef.current = false;
    }
  };

  const rueckrufFeld = (
    <Form.Item
      label="Rückrufnummer"
      name="rueckruf"
      rules={[
        { required: rueckrufNoetig, whitespace: true, message: 'Für einen Rückruf erforderlich' },
      ]}
      style={{ marginBottom: 0 }}
    >
      <Input placeholder="Telefon" />
    </Form.Item>
  );

  return (
    <Form<Werte> form={form} layout="vertical" onFinish={(w) => void absenden(w)}>
      <Flex vertical gap={token.marginXS}>
        {fehler != null && <SpeicherFehler fehler={fehler} titel="Anruf nicht erfasst" />}
        <Schnellerfassungszeile
          gestapelt={istSchmal}
          hinweis={gespeichert > 0 ? `${gespeichert} erfasst` : undefined}
          hinweiszeile={<span>{TASTATURVERTRAG}</span>}
        >
          <Flex wrap gap={token.marginXS} style={{ width: '100%', padding: token.paddingXS }}>
            <Form.Item
              name="anliegen"
              rules={[{ required: true, message: 'Anliegen wählen' }]}
              style={{ marginBottom: 0, minWidth: 180, flex: '0 0 auto' }}
            >
              <Select
                ref={anliegenRef}
                aria-label="Anliegen"
                placeholder="Anliegen"
                options={ANLIEGEN_REIHENFOLGE.map((a) => ({ value: a, label: ANLIEGEN_LABEL[a] }))}
              />
            </Form.Item>
            <Form.Item name="notiz" style={{ marginBottom: 0, flex: '1 1 240px', minWidth: 0 }}>
              <Input aria-label="Notiz" placeholder="Notiz zum Anruf" />
            </Form.Item>
            <Form.Item
              name="rueckruf_noetig"
              valuePropName="checked"
              style={{ marginBottom: 0, alignSelf: 'center' }}
            >
              <Checkbox>Rückruf nötig</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={laeuft}>
              Erfassen
            </Button>
          </Flex>
        </Schnellerfassungszeile>
        {rueckrufNoetig && rueckrufFeld}
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: 'Anrufer und Uhrzeit',
              forceRender: true,
              children: (
                <Flex wrap gap={token.marginSM}>
                  <Form.Item
                    label="Name"
                    name="anrufer_name"
                    style={{ marginBottom: 0, flex: '1 1 200px' }}
                  >
                    <Input />
                  </Form.Item>
                  {!rueckrufNoetig && <div style={{ flex: '1 1 200px' }}>{rueckrufFeld}</div>}
                  <Form.Item
                    label="Uhrzeit"
                    name="eingang"
                    extra="Leer gelassen: jetzt"
                    style={{ marginBottom: 0, flex: '1 1 200px' }}
                  >
                    <ZeitpunktEingabe format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                </Flex>
              ),
            },
          ]}
        />
      </Flex>
    </Form>
  );
}
