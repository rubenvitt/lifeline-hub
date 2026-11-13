import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRollen } from '../components/instrument';

/**
 * Lange Einträge eingeklappt (Spec `etb-zeitachse-darstellung`, „Lange Einträge eingeklappt“):
 * ein Inhalt, der mehr als {@link EINGEKLAPPT_ZEILEN} Zeilen belegen würde (ein Lagebericht mit
 * acht Abschnitten), steht auf drei Zeilen mit „mehr“; „weniger“ klappt ihn wieder zu.
 *
 * Gemessen wird, nicht geschätzt: jeder Inhalt steht unter der Klemme (`etb-inhalt--zu`,
 * `-webkit-line-clamp: 3`, ohne Absatzränder), und lang ist, was darunter herausragt
 * (`scrollHeight > clientHeight`), nach jedem Umbruch neu (`ResizeObserver`). So zählt die Breite
 * der Spalte, nicht die Zeichenzahl, und das Messen kippt nicht: ohne Klemme (aufgeklappt) wird
 * nicht gemessen, der Befund bleibt stehen. Der Text bleibt ganz im DOM: Suche im Browser,
 * Vorleser und Markieren sehen ihn.
 *
 * Aufgeklappt steht er bei einem Sprung (`?eintrag=`) und unter einer Volltextsuche mit Treffer
 * im Inhalt (`offenErzwungen`); dann bietet die Zeile kein „weniger“ an. Im Druck klappt nichts
 * ein (`@media print` in `etbSpaltenzeile.css`; der Druck des ETB ist ohnehin `EtbDruckTabelle`).
 */
export const EINGEKLAPPT_ZEILEN = 3;

export interface Einklappen {
  ref: RefObject<HTMLDivElement | null>;
  /** Steht der Inhalt unter der Klemme (höchstens drei Zeilen)? */
  klemme: boolean;
  /** Steht der Inhalt gerade gekürzt da (Klemme und lang)? */
  zu: boolean;
  /** Belegt der Inhalt mehr als drei Zeilen (und ist nicht erzwungen offen)? Dann gibt es den Knopf. */
  lang: boolean;
  umschalten: () => void;
  /** Kennung der Hülle, Ziel von `aria-controls`. */
  id: string;
}

/** Ragt der Inhalt unter der Klemme heraus? Ohne Layout (0 und 0) nie. */
function istLang(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

export function useEinklappen(offenErzwungen: boolean): Einklappen {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [lang, setLang] = useState(false);
  const [offen, setOffen] = useState(false);
  const klemme = !offen && !offenErzwungen;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !klemme) return;
    const messen = () => setLang(istLang(el));
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [klemme]);
  const umschalten = useCallback(() => setOffen((o) => !o), []);
  return {
    ref,
    klemme,
    zu: lang && klemme,
    lang: lang && !offenErzwungen,
    umschalten,
    id: `${id}-inhalt`,
  };
}

/** Die Hülle des Inhalts mit Zeilenmaß; zugeklappt schneidet `etb-inhalt--zu`. */
export function EinklappHuelle({
  einklappen,
  children,
  style,
}: {
  einklappen: Einklappen;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      ref={einklappen.ref}
      id={einklappen.id}
      data-lfh="etb-inhalt"
      data-eingeklappt={einklappen.zu || undefined}
      className={einklappen.klemme ? 'etb-inhalt etb-inhalt--zu' : 'etb-inhalt'}
      style={style}
    >
      {children}
    </div>
  );
}

/** „mehr“ / „weniger“ — ein Textknopf, nur bei langem Inhalt. */
export function EinklappKnopf({ einklappen }: { einklappen: Einklappen }) {
  const { token } = useRollen();
  if (!einklappen.lang) return null;
  // Die Trefffläche hat die Bedienhöhe, ragt aber in die Polsterung: die Zeile wird nicht höher.
  const ueberstand = Math.max(0, (token.controlHeight - 20) / 2);
  return (
    <button
      type="button"
      className="etb-inhalt-umschalter"
      aria-expanded={!einklappen.zu}
      aria-controls={einklappen.id}
      onClick={einklappen.umschalten}
      style={{ minHeight: token.controlHeight, marginBlock: -ueberstand }}
    >
      {einklappen.zu ? 'mehr' : 'weniger'}
    </button>
  );
}

/**
 * Inhalt mit Knopf darunter — für die Handschirm-Zeile und den gemeinsamen `Zeitachseneintrag`.
 * Die Spaltenzeile setzt den Knopf in die Spalte Vermerk (`EtbSpaltenzeile`).
 */
export function EtbInhalt({
  offenErzwungen,
  children,
  style,
}: {
  offenErzwungen: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const einklappen = useEinklappen(offenErzwungen);
  return (
    <>
      <EinklappHuelle einklappen={einklappen} style={style}>
        {children}
      </EinklappHuelle>
      {einklappen.lang && (
        <div>
          <EinklappKnopf einklappen={einklappen} />
        </div>
      )}
    </>
  );
}
