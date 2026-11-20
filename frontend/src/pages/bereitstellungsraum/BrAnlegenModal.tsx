import { Input } from 'antd';
import { Feld } from '../../components/instrument';
import { BR_BEZEICHNUNG_MAX, BR_NOTIZ_MAX, BR_STANDORT_MAX } from '../../api/eingabegrenzen';
import { ortZeichenRegel, zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import AnlegenModal, { type AnlegenModalSlot } from '../../components/AnlegenModal';
import { legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum } from '../../api/types';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortEingabe } from '../../anzeige/ortsfeldFormular';
import { pflicht } from '../../components/pflichtRegel';

/** Formularwerte: der Standort ist ein Ortsfeld (Text und Koordinate, LLH-1114). */
type BrFormular = Omit<BrEingabe, 'standort' | 'lat' | 'lon'> & { standort?: OrtsfeldWert };

/** Formular → POST-Rumpf: Standort als Text, die Koordinate nur mit Text. */
function brEingabe({ standort, ...rest }: BrFormular): BrEingabe {
  const { text, lat, lon } = ortEingabe(standort);
  return {
    ...rest,
    ...(text != null ? { standort: text } : {}),
    ...(lat != null ? { lat, lon } : {}),
  };
}

/**
 * Dialog zum Anlegen eines Bereitstellungsraums (Liste, Leerzustand, Switcher).
 * Der Standort ist ein Ortsfeld (LLH-1114, Spec `ortsfeld`) und verortet den Raum gleich mit.
 */
export default function BrAnlegenModal(props: AnlegenModalSlot<Bereitstellungsraum>) {
  return (
    <AnlegenModal<Bereitstellungsraum, BrFormular>
      {...props}
      titel="Bereitstellungsraum anlegen"
      erfolgText="Bereitstellungsraum angelegt"
      legeAn={(einsatzId, w) => legeBrAn(einsatzId, brEingabe(w))}
      listenKey={einsatzKeys.br}
    >
      <Feld
        label="Bezeichnung"
        name="bezeichnung"
        rules={[pflicht('Bezeichnung'), zeichenRegel(BR_BEZEICHNUNG_MAX, 'Bezeichnung')]}
      >
        <Input placeholder="z. B. BR Ost" count={zeichenGrenze(BR_BEZEICHNUNG_MAX)} />
      </Feld>
      <Feld
        label="Standort (optional)"
        name="standort"
        rules={[ortZeichenRegel(BR_STANDORT_MAX, 'Standort')]}
      >
        <EinsatzOrtsfeld
          einsatzId={props.einsatzId}
          etikett="Standort"
          count={zeichenGrenze(BR_STANDORT_MAX)}
        />
      </Feld>
      <Feld label="Notiz (optional)" name="notiz" rules={[zeichenRegel(BR_NOTIZ_MAX, 'Notiz')]}>
        <Input.TextArea rows={3} count={zeichenGrenze(BR_NOTIZ_MAX)} />
      </Feld>
    </AnlegenModal>
  );
}
