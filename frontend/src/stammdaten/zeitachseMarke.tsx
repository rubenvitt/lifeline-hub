import { Alert, Form } from 'antd';
import type { ZeitachseMarke } from '../api/types';
import { Select } from '../components/Select';
import { MARKE_WORT } from '../kraefte/zeitachse';

/**
 * Zeitachsen-Marke im Status-Katalog (LFH-552): ein Wechsel auf einen markierten Status schreibt
 * Alarmierung, Eintreffen oder Entlassung in die Kräfte-Zeitachse. Geteilt von Fahrzeug- und
 * Personal-Status, damit beide dieselben Wörter und denselben Hinweis tragen.
 */
const MARKEN = Object.keys(MARKE_WORT) as ZeitachseMarke[];

/** Tabellenspalte „Zeitachse": das Wort der Marke, ohne Marke „—". */
export const markeSpalte = {
  title: 'Zeitachse',
  dataIndex: 'zeitachse_marke',
  key: 'zeitachse_marke',
  render: (m: ZeitachseMarke | null | undefined) => (m ? MARKE_WORT[m] : '—'),
};

/** Formularfeld; leer = keine Marke (der Vollersatz schickt dann `null`). */
export const markeFeld = (
  <Form.Item
    label="Zeitachse (optional)"
    name="zeitachse_marke"
    extra="Ein Wechsel auf diesen Status schreibt das Ereignis in die Kräfte-Zeitachse."
  >
    <Select
      allowClear
      placeholder="keine"
      options={MARKEN.map((m) => ({ value: m, label: MARKE_WORT[m] }))}
    />
  </Form.Item>
);

/**
 * Hinweis, solange kein Eintrag eine Marke trägt: bestehende Kataloge bekommen keine Marke von
 * selbst (Migration 0129), und ohne sie bleibt die Zeitachse leer. Kein Hinweis bei leerem
 * Katalog — dann gibt es nichts zu markieren.
 */
export function markeHinweis(eintraege: readonly { zeitachse_marke?: ZeitachseMarke | null }[]) {
  if (eintraege.length === 0 || eintraege.some((e) => e.zeitachse_marke)) return null;
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      title="Zeitachse: keine Marke gesetzt. Alarmierung, Eintreffen und Entlassung entstehen erst, wenn ein Status eine Marke trägt (Bearbeiten → „Zeitachse (optional)“)."
    />
  );
}
