import { DatePicker, Form, Input, theme } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { alsBackendZeit, alsOrtszeit } from '../etb/filterZeit';
import { parseKoordinate } from './koordinate';

dayjs.extend(utc);

/**
 * Die zwei Formularfelder der Lagedaten einer Person (LFH-613), die Maske
 * (`AufnahmeFelder`) und Detailseite (`PersonenDetailPage`) GLEICH brauchen — eine
 * Schreibweise, ein Prüfweg, eine Zeitumrechnung.
 *
 *  · **Koordinate** — EIN Textfeld `52.2691/9.1342` (Design D6) statt zweier Zahlenfelder,
 *    geprüft über `personen/koordinate.ts`, dieselbe Funktion wie die Schnellerfassungszeile.
 *    Leer ist gültig. Zerlegt wird beim Absenden vom Aufrufer, nicht hier: die Maske schickt
 *    eine leere Koordinate gar nicht, die Detailseite leert mit ihr das Paar.
 *  · **„vermisst seit"** — das Formular hält den WIRE-String (UTC ohne Zone), der Picker
 *    zeigt Ortszeit (`etb/filterZeit.ts`, beidseits der Sommerzeit getestet). Höchstens
 *    fünf Minuten Vorlauf wie im Backend (sonst 400).
 */

/** Wie das Backend: höchstens fünf Minuten Vorlauf (vorgehende Geräteuhr). */
const ZUKUNFT_TOLERANZ_MS = 5 * 60_000;

export function KoordinateFeld() {
  const { token } = theme.useToken();
  return (
    <Form.Item
      label="Koordinate"
      name="koordinate"
      rules={[
        {
          validator: (_, wert?: string) => {
            if (!wert || wert.trim() === '') return Promise.resolve();
            const k = parseKoordinate(wert);
            return k.ok ? Promise.resolve() : Promise.reject(new Error(k.grund));
          },
        },
      ]}
    >
      <Input placeholder="52.2691/9.1342" style={{ fontFamily: token.fontFamilyCode }} />
    </Form.Item>
  );
}

export function VermisstSeitFeld({ hinweis }: { hinweis?: string }) {
  return (
    <Form.Item
      label="vermisst seit"
      name="vermisst_seit"
      extra={hinweis}
      getValueProps={(wert?: string) => ({ value: alsOrtszeit(wert) })}
      normalize={(d?: dayjs.Dayjs | null) => (d ? alsBackendZeit(d) : undefined)}
      rules={[
        {
          validator: (_, wert?: string) =>
            wert && dayjs.utc(wert).valueOf() > Date.now() + ZUKUNFT_TOLERANZ_MS
              ? Promise.reject(new Error('Liegt in der Zukunft'))
              : Promise.resolve(),
        },
      ]}
    >
      <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
    </Form.Item>
  );
}
