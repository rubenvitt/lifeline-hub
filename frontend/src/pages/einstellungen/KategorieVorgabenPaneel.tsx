import { Form, Input, InputNumber, Typography } from 'antd';
import { Formularpaneel } from '../../components/instrument';
import { KATEGORIE_TEXT, KATEGORIEN, PERSONENSTAMM_TEXT } from '../../aufbewahrung/kategorieText';
import type { FormWerteEinsatz } from './orgEinstellungenForm';

/**
 * Paneel „Aufbewahrung je Datenkategorie“ der Einsatz-Defaults (LFH-749, Spec
 * `aufbewahrung-kategorien`, „Kategorie-Dauer in den Org-Einstellungen“). Steht im Formular der
 * Seite und speichert mit ihr.
 *
 * **Keine Vorgabewerte:** der Vorschlag steht als Text mit Quelle unter dem Feld, nie als Wert.
 * Eine Dauer braucht eine Rechtsgrundlage (der Server antwortet sonst 422). Übersteigt die Dauer
 * die Aufbewahrungsdauer der Organisation, sagt ein Hinweis, dass dann die Einsatz-Frist greift.
 */
export default function KategorieVorgabenPaneel() {
  const form = Form.useFormInstance<FormWerteEinsatz>();
  const einsatzDauer = Form.useWatch('retention_dauer_tage', form);
  const kategorien = Form.useWatch('kategorien', form);

  return (
    <Formularpaneel
      titel="Aufbewahrung je Datenkategorie"
      beschreibung={`Eigene Frist für einzelne Datenkategorien, ab Abschluss des Einsatzes. Nach Ablauf wird die Kategorie vorgemerkt und nach 30 Tagen Karenz unwiderruflich geschwärzt; der Einsatz bleibt lesbar. Leer = die Kategorie folgt der Frist des Einsatzes. Jede Dauer braucht eine Rechtsgrundlage. ${PERSONENSTAMM_TEXT}`}
    >
      {KATEGORIEN.map((k) => {
        const text = KATEGORIE_TEXT[k];
        const dauer = kategorien?.[k]?.dauer_tage;
        const laengerAlsEinsatz = dauer != null && einsatzDauer != null && dauer > einsatzDauer;
        return (
          <div key={k}>
            <Form.Item
              label={`Dauer ${text.bezeichnung} (Tage)`}
              name={['kategorien', k, 'dauer_tage']}
              tooltip={`0 bis 3650 Tage. Umfasst: ${text.daten}.`}
              extra={
                <>
                  Vorschlag: {text.vorschlag.tage} Tage — {text.vorschlag.quelle}
                  {laengerAlsEinsatz && (
                    <Typography.Text type="warning" style={{ display: 'block' }}>
                      Länger als die Aufbewahrungs-Dauer der Organisation ({einsatzDauer} Tage) —
                      dann greift die Einsatz-Frist zuerst.
                    </Typography.Text>
                  )}
                </>
              }
            >
              <InputNumber
                min={0}
                max={3650}
                style={{ width: '100%', maxWidth: 200 }}
                placeholder="keine"
              />
            </Form.Item>
            <Form.Item
              label={`Rechtsgrundlage ${text.bezeichnung}`}
              name={['kategorien', k, 'rechtsgrundlage']}
              dependencies={[['kategorien', k, 'dauer_tage']]}
              rules={[
                { max: 500, message: 'Höchstens 500 Zeichen' },
                ({ getFieldValue }) => ({
                  validator: (_, wert: string | undefined) =>
                    getFieldValue(['kategorien', k, 'dauer_tage']) != null && !wert?.trim()
                      ? Promise.reject(new Error('Rechtsgrundlage angeben'))
                      : Promise.resolve(),
                }),
              ]}
            >
              <Input placeholder="z. B. Paragraf und Gesetz" />
            </Form.Item>
          </div>
        );
      })}
    </Formularpaneel>
  );
}
