import type { Geschlecht } from '../../api/types';
import { Segmentleiste } from '../../components/instrument';
import { GESCHLECHT_WORT } from '../../personen/personMeta';
import { GESCHLECHT_KURZ } from './registrierKern';

const OPTIONEN = (Object.keys(GESCHLECHT_KURZ) as Geschlecht[]).map((g) => ({
  wert: g,
  label: GESCHLECHT_KURZ[g],
  name: GESCHLECHT_WORT[g],
}));

/**
 * Geschlecht als Segment „m · w · d · ?“ der Registriermaske (LLH-1612, design.md D8): kurz auf
 * der Fläche, das volle Wort (`GESCHLECHT_WORT`) im zugänglichen Namen. Ohne Wahl ist kein Segment
 * gewählt; „?“ ist der Wert `unbekannt`. Formularvertrag wie ein antd-Feld (`value`/`onChange`),
 * `id` an der Hülle, damit die Beschriftung des `Form.Item` ein Ziel hat.
 */
export default function GeschlechtWahl({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value?: Geschlecht | null;
  onChange?: (wert: Geschlecht) => void;
  'aria-label': string;
}) {
  return (
    <div id={id}>
      <Segmentleiste<Geschlecht | ''>
        beschriftung={ariaLabel}
        // Ohne Wahl ein Wert außerhalb der Optionen: kein Segment ist gewählt.
        wert={value ?? ''}
        onWechsel={(w) => {
          if (w !== '') onChange?.(w);
        }}
        optionen={OPTIONEN}
      />
    </div>
  );
}
