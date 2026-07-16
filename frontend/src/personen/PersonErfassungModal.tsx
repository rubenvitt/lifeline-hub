import { Form, Input, InputNumber, Modal } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import type { PersonEingabe } from '../api/einsatzPerson';

/** Erfassungs-Modi der Personen-Schnellerfassung. `null` = Modal geschlossen. */
export type ErfassungsModus = 'schnell' | 'vermisst' | 'betroffen';

interface Props {
  /** Aktueller Modus (steuert Titel + optionales Vermisst-Feld); `null` schließt das Modal. */
  modus: ErfassungsModus | null;
  /** Läuft die Anlege-Mutation? → Bestätigen-Button zeigt Spinner. */
  isPending: boolean;
  /** Formular abgeschickt (gültige Werte). Der Aufrufer leitet den Folgestatus aus `modus` ab. */
  onFinish: (daten: PersonEingabe) => void;
  /** Abbrechen/Schließen. Der Aufrufer setzt `modus` auf `null`. */
  onCancel: () => void;
}

/** Schnellerfassungs-Modal für Personen (Schnell/Vermisst/Betroffen). Props-gesteuert:
 *  der Aufrufer (PersonenPage) hält `modus`-State und die Anlege-Mutation, dieses Modal
 *  besitzt nur das Formular. Nach dem Schließen wird das Formular geleert (antd `preserve`
 *  würde die Werte sonst über das nächste Öffnen hinweg behalten). */
export default function PersonErfassungModal({ modus, isPending, onFinish, onCancel }: Props) {
  const [form] = Form.useForm<PersonEingabe>();

  useEffect(() => {
    if (modus === null) form.resetFields();
  }, [modus, form]);

  return (
    <Modal
      open={modus !== null}
      title={modus === 'vermisst' ? 'Vermisst melden' : modus === 'betroffen' ? 'Betroffene/n erfassen' : 'Schnellerfassung'}
      okText="Erfassen"
      confirmLoading={isPending}
      onOk={() => form.submit()}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item label="Geschlecht" name="geschlecht">
          <Select
            allowClear
            placeholder="unbekannt"
            options={[
              { value: 'maennlich', label: 'männlich' },
              { value: 'weiblich', label: 'weiblich' },
              { value: 'divers', label: 'divers' },
              { value: 'unbekannt', label: 'unbekannt' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt">
          <InputNumber min={0} max={120} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item label="Antreffort" name="antreff_ort"><Input placeholder="z. B. Brücke, Sammelstelle" /></Form.Item>
        <Form.Item label="Name" name="name"><Input /></Form.Item>
        <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
        {modus === 'vermisst' && (
          <Form.Item label="Melder / Kontakt" name="melder_kontakt">
            <Input placeholder="Angehöriger, Kontaktdaten" />
          </Form.Item>
        )}
        <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
