import { useCallback, useRef, useState } from 'react';

/**
 * Der Besitzer-Teil zu `FormularEingehaengt` (LFH-627, Begründung dort): `melde` gehört an
 * `<FormularEingehaengt onWechsel={melde} />` im `<Form>`.
 *
 * - `da`: hängt das `<Form>` jetzt? Erst dann darf ein Effekt die Instanz anfassen.
 * - `jeDa`: hing es überhaupt schon einmal? Vorher hält die Instanz nichts, was ein Zurücksetzen
 *   räumen müsste (etwa beim Einsatzwechsel eines geschlossenen Dialogs, dessen Speicher
 *   `destroyOnHidden` überlebt), und `resetFields()` an ihr meldete „not connected". Eine Ref,
 *   weil sie nur in Effekten gelesen wird und keinen Render auslösen soll.
 */
export function useFormularEingehaengt() {
  const [da, setDa] = useState(false);
  const jeDa = useRef(false);
  const melde = useCallback((neu: boolean) => {
    if (neu) jeDa.current = true;
    setDa(neu);
  }, []);
  return { da, jeDa, melde };
}
