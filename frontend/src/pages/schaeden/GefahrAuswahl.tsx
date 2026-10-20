import type { ReactNode } from 'react';
import { Form, Space } from 'antd';
import type { Ausmass, Gefahrentyp, Schadensgrad } from '../../api/types';
import { Select } from '../../components/Select';
import EinsatzZeichen from '../../zeichen/EinsatzZeichen';
import { schadenTz } from '../lagekarte/taktischesZeichen';
import { GEFAHR_LABEL, GEFAHRENARTEN, SCHADENSGRAD_LABEL } from './schadenHelfer';

/** Kantenlänge der Zeichenvorschau in der Auswahl. */
const VORSCHAU_PX = 20;

/**
 * Auswahl der Gefahr eines Schadens (LLH-1115, design.md D4): neben jedem Wort das Kartenzeichen,
 * das der Schaden damit bekommt, in der Farbe des gewählten Ausmaßes. Die Vorschau steht auf der
 * hellen Unterlage (`EinsatzZeichen`), damit sie im Nachtbetrieb lesbar bleibt. Leeren heißt
 * „keine Angabe“ (`null`). Für `Form.Item`: `value`/`onChange` kommen von dort.
 */
export function GefahrAuswahl({
  ausmass,
  schadensgrad,
  value,
  onChange,
  id,
}: {
  ausmass?: Ausmass | null;
  schadensgrad?: Schadensgrad | null;
  value?: Gefahrentyp | null;
  onChange?: (wert: Gefahrentyp | null) => void;
  id?: string;
}) {
  return (
    <Select<
      Gefahrentyp | null,
      { value: Gefahrentyp; label: ReactNode; wort: string; title: string }
    >
      id={id}
      allowClear
      placeholder="keine Angabe"
      value={value ?? undefined}
      onChange={(w) => onChange?.(w ?? null)}
      showSearch={{ optionFilterProp: 'wort' }}
      options={GEFAHRENARTEN.map((g) => ({
        value: g,
        wort: GEFAHR_LABEL[g],
        // Das Etikett ist ein Element; der Titel trägt das Wort für Hover und Auswahl per Titel.
        title: GEFAHR_LABEL[g],
        label: (
          <Space size={8} align="center">
            <EinsatzZeichen
              tz={schadenTz(ausmass, g, schadensgrad)}
              size={VORSCHAU_PX}
              unterlage
              style={{ display: 'block' }}
            />
            {GEFAHR_LABEL[g]}
          </Space>
        ),
      }))}
    />
  );
}

/**
 * `GefahrAuswahl` in einem Formular mit den Feldern `ausmass` und `schadensgrad`: die Vorschau
 * folgt den dort gewählten Werten. `value`/`onChange`/`id` reicht `Form.Item` durch.
 */
export function GefahrAuswahlImFormular(props: {
  value?: Gefahrentyp | null;
  onChange?: (wert: Gefahrentyp | null) => void;
  id?: string;
}) {
  const ausmass = Form.useWatch('ausmass') as Ausmass | undefined;
  const schadensgrad = Form.useWatch('schadensgrad') as Schadensgrad | null | undefined;
  return <GefahrAuswahl {...props} ausmass={ausmass} schadensgrad={schadensgrad} />;
}

/** Auswahl des Schadensgrads (5.8.4); leeren heißt „keine Angabe“. */
export function SchadensgradAuswahl({
  value,
  onChange,
  id,
}: {
  value?: Schadensgrad | null;
  onChange?: (wert: Schadensgrad | null) => void;
  id?: string;
}) {
  return (
    <Select<Schadensgrad | null>
      id={id}
      allowClear
      placeholder="keine Angabe"
      value={value ?? undefined}
      onChange={(w) => onChange?.(w ?? null)}
      options={(Object.keys(SCHADENSGRAD_LABEL) as Schadensgrad[]).map((g) => ({
        value: g,
        label: SCHADENSGRAD_LABEL[g],
      }))}
    />
  );
}
