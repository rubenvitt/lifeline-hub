import type { FormInstance } from 'antd';
import { useEffect, useRef } from 'react';

/**
 * Welcher Abschnitt bekommt beim Öffnen eines Entwurfs den Einstiegsfokus: **der erste ohne
 * Text, sonst der erste überhaupt**. Rein und exportiert, damit die Wahl ohne Render prüfbar
 * ist (Muster `bedienzielStil`, LFH-365).
 *
 * Die Bedienentscheidung hinter dem „ersten leeren" (LFH-495, das Ticket liess sie offen):
 * ein fortgeschriebener Bericht trägt die Abschnitte des Vorgängers bereits befüllt, der
 * erste leere ist also die Stelle, an der die Arbeit weitergeht. Der Titel ist dafür der
 * falsche Kandidat — er ist beim Anlegen UND beim Fortschreiben schon gesetzt, ein Fokus
 * dort sässe regelmässig auf dem einen Feld, das niemand anfassen will.
 *
 * Leerraum zählt nicht, gleichlautend mit `befuellteAbschnitte` — ein Abschnitt aus drei
 * Leerzeichen ist leer. Ist ALLES befüllt, fällt die Wahl auf den ersten Abschnitt statt auf
 * „gar keinen": die Seite ist dann eine Überarbeitung, und der Tastaturweg soll trotzdem im
 * Text beginnen und nicht auf `<body>`.
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
 * Setzt den Einstiegsfokus — und ist eine KOMPONENTE im Formularzweig, kein Effekt in der
 * Seite. Der Grund ist der Zeitpunkt: beide Entwurfsseiten zeigen erst einen `<Spin>`, das
 * `<Form>` entsteht also Runden später als die Seite. Ein `useEffect(…, [])` oben liefe,
 * während es das Feld noch nicht gibt, und käme nie wieder — dieselbe Falle, die
 * `pages/ChatPage.tsx` (C8/H51) mit einem Callback-Ref löst. Hier ist der Mount dieser
 * Komponente der feste Punkt: sie steht als LETZTES Kind im Formular, React führt Effekte
 * nach dem Commit des ganzen Baums aus, also stehen alle Felder im DOM.
 *
 * EIN EFFEKT, KEIN `requestAnimationFrame` (Lektion aus `components/Erfassung.tsx`): ein
 * aufgeschobener Fokus greift, wann immer das Bild kommt — notfalls erst, wenn die Person
 * schon tippt, und reisst den Cursor dann mitten im Wortlaut zurück.
 *
 * DAS ZIEL WIRD AM MOUNT EINGEFROREN (`useRef`-Initialwert, nie neu zugewiesen). Eine
 * lebende Prop wäre ein Fehler: sobald jemand den leeren Abschnitt befüllt, zeigte
 * `einstiegsAbschnitt` auf den NÄCHSTEN leeren, und der Fokus spränge beim ersten Autosave
 * weiter. Je Datensatz genau einmal — der Remount über `key={id}` ist der Reset.
 *
 * GESTOHLEN WIRD KEIN FOKUS: liegt er schon irgendwo (jemand hat in der Ladezeit die
 * Kopfzeile angefasst), bleibt er dort. Der Scroll bleibt der native des Browsers —
 * `preventScroll` wäre hier falsch, sonst tippt man im Befehl in ein Feld unterhalb des
 * Bildes; die verankerte Aktionsleiste hält es über `scroll-padding-block-end` frei
 * (LFH-465).
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
