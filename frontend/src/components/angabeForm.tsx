import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

/**
 * Wie eine `InlineAngabe` ihre Bearbeitung zeigt (LLH-1795, Change `lsug0joq-tabellen-touch`, D2):
 * `fluss` setzt Eingabe und Knöpfe an die Stelle der Anzeige (Karten, Ansichten), `schwebend`
 * lässt die Anzeige stehen und öffnet die Bearbeitung in einem Popover an ihr (Tabellenzellen).
 * In einer Zelle sprengte das Formular sonst ihre Breite, und im Auto-Layout verteilten sich alle
 * Spalten neu. `KatalogTabelle` setzt `schwebend` um den Körper und `fluss` um aufgeklappte Zeilen.
 */
export type AngabeForm = 'fluss' | 'schwebend';

/** Eine offene schwebende Bearbeitung, wie die Tabelle sie kennt. */
export interface OffeneAngabe {
  /** Hat sie einen geänderten, ungespeicherten Entwurf? */
  geaendert: () => boolean;
  schliessen: () => void;
  /** Holt den Fokus in ihre Eingabe zurück. */
  fokus: () => void;
}

interface Kontext {
  form: AngabeForm;
  /**
   * Meldet eine schwebende Bearbeitung an, die öffnen will. Ist eine andere offen und geändert,
   * bekommt sie den Fokus, und die neue öffnet nicht (`false`); ist sie unverändert, schließt sie.
   */
  oeffne: (angabe: OffeneAngabe) => boolean;
  /** Meldet das Schließen; nur die zuletzt geöffnete wird ausgetragen. */
  schliesse: (angabe: OffeneAngabe) => void;
}

const FLUSS: Kontext = { form: 'fluss', oeffne: () => true, schliesse: () => {} };
const AngabeFormKontext = createContext<Kontext>(FLUSS);

export function AngabeFormProvider({ form, children }: { form: AngabeForm; children: ReactNode }) {
  const offen = useRef<OffeneAngabe | null>(null);
  const wert = useMemo<Kontext>(
    () =>
      form === 'fluss'
        ? FLUSS
        : {
            form,
            oeffne: (angabe) => {
              const vorige = offen.current;
              if (vorige && vorige !== angabe) {
                if (vorige.geaendert()) {
                  vorige.fokus();
                  return false;
                }
                vorige.schliessen();
              }
              offen.current = angabe;
              return true;
            },
            schliesse: (angabe) => {
              if (offen.current === angabe) offen.current = null;
            },
          },
    [form],
  );
  return <AngabeFormKontext.Provider value={wert}>{children}</AngabeFormKontext.Provider>;
}

export function useAngabeForm(): Kontext {
  return useContext(AngabeFormKontext);
}
