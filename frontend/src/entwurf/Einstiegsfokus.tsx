import type { FormInstance } from 'antd';
import { useEffect, useRef } from 'react';

/**
 * Welcher Abschnitt beim Öffnen eines Entwurfs den Einstiegsfokus bekommt: **der erste ohne
 * Text, sonst der erste überhaupt**. Rein und exportiert.
 *
 * Ein fortgeschriebener Bericht trägt die Abschnitte des Vorgängers befüllt; der erste leere
 * ist die Stelle, an der die Arbeit weitergeht. Der Titel ist beim Anlegen und Fortschreiben
 * schon gesetzt und damit der falsche Kandidat. Leerraum zählt nicht (wie
 * `befuellteAbschnitte`). Ist alles befüllt, der erste Abschnitt statt `<body>`.
 */
export function einstiegsAbschnitt(
  schluessel: readonly string[],
  text: (schluessel: string) => string | undefined,
): string | undefined {
  return schluessel.find((s) => !(text(s) ?? '').trim()) ?? schluessel[0];
}

interface Props<W extends object> {
  form: FormInstance<W>;
  /** Feldname des Ziels aus `einstiegsAbschnitt`. `undefined` → kein Fokus. */
  feld: string | undefined;
}

/**
 * Setzt den Einstiegsfokus — als KOMPONENTE im Formularzweig, kein Effekt in der Seite: beide
 * Entwurfsseiten zeigen erst einen `<Spin>`, ein `useEffect(…, [])` oben liefe ohne Feld und
 * käme nie wieder. Als letztes Kind im Formular stehen beim Effekt alle Felder im DOM.
 *
 * Ein Effekt, kein `requestAnimationFrame`: ein aufgeschobener Fokus griffe notfalls erst,
 * wenn die Person schon tippt.
 *
 * DAS ZIEL WIRD AM MOUNT EINGEFROREN: sonst zeigte `einstiegsAbschnitt` nach dem Befüllen auf
 * den nächsten leeren und der Fokus spränge beim ersten Autosave weiter. Der Remount über
 * `key={id}` ist der Reset.
 *
 * KEIN FOKUS-DIEBSTAHL: liegt er schon irgendwo, bleibt er dort. Der Scroll bleibt der native
 * (`preventScroll` wäre falsch); die verankerte Aktionsleiste hält das Feld über
 * `scroll-padding-block-end` frei.
 */
export default function Einstiegsfokus<W extends object>({ form, feld }: Props<W>) {
  const zielRef = useRef(feld);
  useEffect(() => {
    const ziel = zielRef.current;
    if (!ziel) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    // `getFieldInstance` liefert die Ref des Feld-Kindes; `MarkdownEditor` reicht sie per
    // `forwardRef` an antds `Input.TextArea` durch, die ein `focus()` mitbringt.
    const instanz = form.getFieldInstance(ziel) as { focus?: () => void } | null | undefined;
    instanz?.focus?.();
  }, [form]);
  return null;
}
