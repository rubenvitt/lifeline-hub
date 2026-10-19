import { AutoComplete, Form, Input, type FormInstance } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { ladeTransportmittel } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import StatusTag from '../components/StatusTag';
import { transportDurch } from '../theme/statusFarben';
import {
  rettungsmittelOptionen,
  type RettungsmittelOption,
  type VerbleibFormWerte,
} from './verbleibErfassungKern';

/**
 * Das Feld „Rettungsmittel“ der Verbleib-Maske beim Transport (LLH-1332, Change
 * `y4l621ih-patientenverbleib-uebergabe`, design.md D5). Ein Feld statt Schalter plus Feld, damit
 * die Maske ihr Budget hält: eine Wahl aus „Im Einsatz“ setzt die Disposition ins versteckte Feld
 * `einsatz_fahrzeug_id` (Eigentransport), jede Texteingabe leert es (fremdes Rettungsmittel). Die
 * Marke am Feld sagt den Ausgang, kein Erklärtext.
 *
 * **Enter übernimmt nur eine angesteuerte Option** (Muster `RufnameInput` in
 * `pages/EinsatzdatenPage.tsx`): rc-select macht beim Tippen still die erste passende Option
 * aktiv; Enter übernähme sie und schickte das Formular nicht ab. Ohne Pfeiltaste seit der letzten
 * Eingabe hält die Capture-Phase Enter deshalb von rc-select fern.
 */
export default function RettungsmittelFeld({
  einsatzId,
  form,
  fokus = false,
}: {
  einsatzId: number;
  form: FormInstance<VerbleibFormWerte>;
  /**
   * Das Feld ist das Fokusziel der Erfassungshülle (`[data-erfassung-fokus]`): wenn die Art schon
   * vorbelegt ist, etwa im Grundriss, beginnt die Eingabe hier statt an der Art.
   */
  fokus?: boolean;
}) {
  const auswahl = useQuery({
    queryKey: einsatzKeys.personenTransportmittel(einsatzId),
    queryFn: () => ladeTransportmittel(einsatzId),
  });
  const fahrzeugId = Form.useWatch('einsatz_fahrzeug_id', form);
  const navigiert = useRef(false);
  const durch = fahrzeugId != null ? 'eigen' : 'fremd';
  const suche = (t: string) => t.toLocaleLowerCase('de');
  return (
    <>
      <Form.Item
        label={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Rettungsmittel
            <StatusTag darstellung={transportDurch[durch]} />
          </span>
        }
        name="transportmittel"
        rules={[{ required: true, whitespace: true, message: 'Rettungsmittel angeben' }]}
      >
        <RettungsmittelEingabe
          optionen={rettungsmittelOptionen(auswahl.data)}
          navigiert={navigiert}
          suche={suche}
          fokus={fokus}
          onWahl={(option) =>
            form.setFieldValue('einsatz_fahrzeug_id', option?.einsatzFahrzeugId ?? null)
          }
        />
      </Form.Item>
      <Form.Item name="einsatz_fahrzeug_id" hidden>
        <input type="hidden" />
      </Form.Item>
    </>
  );
}

/** Die Eingabe selbst; `value`/`onChange`/`id` reicht das `Form.Item` durch. */
function RettungsmittelEingabe({
  id,
  value,
  onChange,
  optionen,
  navigiert,
  suche,
  fokus,
  onWahl,
}: {
  id?: string;
  fokus: boolean;
  value?: string;
  onChange?: (v: string) => void;
  optionen: ReturnType<typeof rettungsmittelOptionen>;
  navigiert: React.MutableRefObject<boolean>;
  suche: (t: string) => string;
  onWahl: (option: RettungsmittelOption | undefined) => void;
}) {
  return (
    <div
      onKeyDownCapture={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigiert.current = true;
        else if (e.key === 'Enter' && !navigiert.current) e.stopPropagation();
      }}
    >
      <AutoComplete
        id={id}
        value={value}
        // Gruppen tragen `options`; antds Typ kennt nur flache Optionen (Muster `rufnameOptions`).
        options={optionen as unknown as RettungsmittelOption[]}
        filterOption={(eingabe, option) =>
          option != null &&
          'value' in option &&
          typeof option.value === 'string' &&
          suche(String(option.label ?? option.value)).includes(suche(eingabe.trim()))
        }
        onChange={(v?: string) => {
          navigiert.current = false;
          onChange?.(v ?? '');
          // Jede Eingabe heißt zunächst fremd; erst eine Wahl aus „Im Einsatz“ macht eigen.
          onWahl(undefined);
        }}
        onSelect={(_wert: string | undefined, option: RettungsmittelOption) => {
          navigiert.current = false;
          onWahl(option);
        }}
        style={{ width: '100%' }}
      >
        {/* Eigenes Eingabefeld, damit die Fokusmarke am `<input>` sitzt, nicht am Rahmen. */}
        <Input
          placeholder="z. B. 1/83-1 oder RTW 3/83-2"
          data-erfassung-fokus={fokus || undefined}
        />
      </AutoComplete>
    </div>
  );
}
