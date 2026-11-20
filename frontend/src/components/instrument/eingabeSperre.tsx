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

/** `zeigtGrund`: die Stelle nennt einen gemeldeten Grund selbst (Fehlerzeile, `FeldFehler`). */
const SperrKontext = createContext<{ melden: Melden; zeigtGrund: boolean } | null>(null);

/** Für Steuerelemente: meldet den eigenen Grund (`null` = frei); räumt beim Aushängen ab. */
export function useEingabeSperre(): (grund: string | null) => void {
  const melden = useContext(SperrKontext)?.melden;
  const quelle = useId();
  useEffect(() => () => melden?.(quelle, null), [melden, quelle]);
  return useCallback((grund: string | null) => melden?.(quelle, grund), [melden, quelle]);
}

/**
 * Nennt die Stelle darüber einen gemeldeten Grund selbst? Dann nennt das Steuerelement ihn nicht
 * noch einmal.
 */
export function useSperrStelleZeigtGrund(): boolean {
  return useContext(SperrKontext)?.zeigtGrund ?? false;
}

/** Die Stelle, an die Steuerelemente darunter melden. */
export function SperrStelle({
  melden,
  zeigtGrund = true,
  children,
}: {
  melden: Melden;
  zeigtGrund?: boolean;
  children: ReactNode;
}) {
  const wert = useMemo(() => ({ melden, zeigtGrund }), [melden, zeigtGrund]);
  return <SperrKontext.Provider value={wert}>{children}</SperrKontext.Provider>;
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
 * Die Stelle eines Formularfelds: Prüfregel und Meldeweg. Wechselt der Grund, prüft das Feld neu:
 * die Fehlerzeile nennt ihn sofort und verschwindet mit ihm.
 */
export function useSperrStelle(name: NamePath | undefined): { melden: Melden; regel: FormRule } {
  const form = Form.useFormInstance();
  const { melden, grund } = useSperrSammler(() => {
    if (name === undefined) return;
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
