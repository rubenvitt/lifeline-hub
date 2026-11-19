import { Collapse, Form, Input, theme } from 'antd';
import { useState } from 'react';
import { Feld } from '../../components/instrument';
import { Select } from '../../components/Select';
import AnlegenModal, { type AnlegenModalSlot } from '../../components/AnlegenModal';
import { legeUhsAn, type UhsEingabe } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type { Uhs } from '../../api/types';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortEingabe } from '../../anzeige/ortsfeldFormular';
import { uhsTyp } from '../../theme/statusFarben';

/** Formularwerte: der Standort ist ein Ortsfeld (Text und Koordinate, LLH-1114). */
type UhsFormular = Omit<UhsEingabe, 'standort' | 'lat' | 'lon'> & { standort?: OrtsfeldWert };

/** Formular → POST-Rumpf: Standort als Text, die Koordinate nur mit Text. */
function uhsEingabe({ standort, ...rest }: UhsFormular): UhsEingabe {
  const { text, lat, lon } = ortEingabe(standort);
  return {
    ...rest,
    ...(text != null ? { standort: text } : {}),
    ...(lat != null ? { lat, lon } : {}),
  };
}

/** Kopf der eingeklappten Angaben: nennt die Notiz, sobald etwas drinsteht. */
function WeitereAngabenTitel() {
  const notiz = Form.useWatch<string | undefined>('notiz');
  return notiz?.trim() ? 'Weitere Angaben · Notiz' : 'Weitere Angaben';
}

/**
 * Dialog zum Anlegen einer UHS (Liste, Leerzustand, Switcher). Der Standort ist ein Ortsfeld
 * (LLH-1114, Spec `ortsfeld`): ein Treffer, eine getippte Koordinate oder ein Punkt auf der Karte
 * verortet die UHS gleich beim Anlegen.
 *
 * Feldbudget des Dialogs (LLH-1921, design.md D2): Bezeichnung, Typ und Standort sichtbar, die
 * Notiz unter „Weitere Angaben“. Sie darf dorthin, weil sie optional ist und keine Ablehnung
 * auslösen kann; der Kopf nennt sie, sobald etwas drinsteht.
 */
export default function UhsAnlegenModal(props: AnlegenModalSlot<Uhs>) {
  const { token } = theme.useToken();
  const [weitereOffen, setWeitereOffen] = useState(false);
  return (
    <AnlegenModal<Uhs, UhsFormular>
      {...props}
      // Der Dialog bleibt bei Liste und Switcher eingehängt; jedes Öffnen beginnt zugeklappt.
      onClose={() => {
        setWeitereOffen(false);
        props.onClose();
      }}
      titel="Unfallhilfsstelle anlegen"
      erfolgText="UHS angelegt"
      legeAn={(einsatzId, w) => legeUhsAn(einsatzId, uhsEingabe(w))}
      listenKey={einsatzKeys.uhs}
      initialValues={{ typ: 'behandlungsplatz' }}
    >
      <Feld
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
      >
        <Input placeholder="z. B. BHP 50" />
      </Feld>
      <Feld label="Typ" name="typ" rules={[{ required: true }]}>
        <Select options={Object.entries(uhsTyp).map(([v, d]) => ({ value: v, label: d.label }))} />
      </Feld>
      <Feld label="Standort (optional)" name="standort">
        <EinsatzOrtsfeld einsatzId={props.einsatzId} etikett="Standort" />
      </Feld>
      {/* `forceRender`: Prüfung und Zurücksetzen erreichen die Notiz auch zugeklappt. */}
      <Collapse
        ghost
        style={{ marginInline: -token.paddingSM }}
        activeKey={weitereOffen ? ['weitere'] : []}
        onChange={(k) => setWeitereOffen(k.includes('weitere'))}
        items={[
          {
            key: 'weitere',
            forceRender: true,
            label: <WeitereAngabenTitel />,
            children: (
              <Feld label="Notiz (optional)" name="notiz">
                <Input.TextArea rows={3} />
              </Feld>
            ),
          },
        ]}
      />
    </AnlegenModal>
  );
}
