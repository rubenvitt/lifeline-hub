import { Form } from 'antd';
import type { FormRule } from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/**
 * Eingabesperre (LLH-1768, `frontend/AGENTS.md`, „Zeiteingabe ist ein Textfeld“): Ein
 * Steuerelement, das getippten Text nicht übernehmen konnte und ihn stehen lässt (die
 * Zeiteingabe nach dem Verlassen), meldet seinen Grund an die Stelle darüber. Die Stelle sperrt
 * das Senden: `Feld` und `DatenfeldEingabe` über eine Prüfregel, `InlineAngabe` im eigenen
 * Absenden. Ohne Stelle geht die Meldung ins Leere: Filter und Druckauswahl senden nichts.
 */
type Melden = (quelle: string, grund: string | null) => void;

const SperrKontext = createContext<Melden | null>(null);

/** Für Steuerelemente: meldet den eigenen Grund (`null` = frei); räumt beim Aushängen ab. */
export function useEingabeSperre(): (grund: string | null) => void {
  const melden = useContext(SperrKontext);
  const quelle = useId();
  useEffect(() => () => melden?.(quelle, null), [melden, quelle]);
  return useCallback((grund: string | null) => melden?.(quelle, grund), [melden, quelle]);
}

/** Die Stelle, an die Steuerelemente darunter melden. */
export function SperrStelle({ melden, children }: { melden: Melden; children: ReactNode }) {
  return <SperrKontext.Provider value={melden}>{children}</SperrKontext.Provider>;
}

/**
 * Sammelt die Gründe mehrerer Quellen (ein Zeitraum hat zwei Felder). `onWechsel` hört, wenn sich
 * der erste Grund ändert.
 */
export function useSperrSammler(onWechsel?: (grund: string | null) => void): {
  melden: Melden;
  grund: () => string | null;
} {
  const gruende = useRef(new Map<string, string>());
  const wechsel = useRef(onWechsel);
  wechsel.current = onWechsel;
  const grund = useCallback(() => gruende.current.values().next().value ?? null, []);
  const melden = useCallback<Melden>(
    (quelle, neu) => {
      const vorher = grund();
      if (neu) gruende.current.set(quelle, neu);
      else gruende.current.delete(quelle);
      const nachher = grund();
      if (vorher !== nachher) wechsel.current?.(nachher);
    },
    [grund],
  );
  return { melden, grund };
}

/**
 * Die Stelle eines Formularfelds: Prüfregel und Meldeweg. Weicht der Grund, während das Feld einen
 * Fehler zeigt, prüft es neu, damit die Fehlerzeile mit dem Grund verschwindet.
 */
export function useSperrStelle(name: NamePath | undefined): { melden: Melden; regel: FormRule } {
  const form = Form.useFormInstance();
  const { melden, grund } = useSperrSammler(() => {
    if (name === undefined || form.getFieldError(name).length === 0) return;
    form.validateFields([name]).catch(() => {});
  });
  const regel = useMemo<FormRule>(
    () => ({
      validator() {
        const g = grund();
        return g ? Promise.reject(new Error(g)) : Promise.resolve();
      },
    }),
    [grund],
  );
  return { melden, regel };
}
