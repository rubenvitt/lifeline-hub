import { useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';

export interface LinkAuftrag {
  /** Hat dieser Auftrag den aktuellen Verlaufseintrag schon verbraucht? */
  verbraucht: () => boolean;
  /**
   * Verbraucht den Verlaufseintrag und ersetzt die Adresse durch `naechste` (`replace`). Auch ein
   * Schritt, der den Auftrag stehen lässt (etwa ein Ansichtswechsel davor), läuft hierüber: der
   * nächste Eintrag trägt den Auftrag dann neu.
   */
  weiter: (naechste: URLSearchParams) => void;
  /** Verbraucht den Verlaufseintrag und räumt die genannten Parameter (`replace`). */
  raeume: (...namen: string[]) => void;
}

/**
 * Ein Link-Auftrag (`?zentrum=…`, `?platzieren=…` usw.) gilt einmal je Verlaufseintrag
 * (`location.key`).
 *
 * Apply-then-clean räumt den Auftrag mit einer Navigation. React Router rendert sie in einer
 * Transition: Die Adresse ist sofort leer, `searchParams` zeigt unter Last aber noch eine Weile den
 * alten Auftrag. Ändert sich bis dahin eine Abhängigkeit des Effekts (eine Liste lädt neu, ein
 * Handler ist neu), liefe der Auftrag ein zweites Mal: ein beendeter Modus startete neu, eine
 * aufgehobene Auswahl stünde wieder. Ein neuer Link derselben Art ist ein neuer Eintrag und wirkt.
 *
 * Je Auftrag ein eigener Aufruf: Trägt ein Link zwei Aufträge, verbraucht keiner den des anderen.
 */
export function useLinkAuftrag(): LinkAuftrag {
  const { key } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const verbrauchtRef = useRef<string | null>(null);
  return useMemo(() => {
    const weiter = (naechste: URLSearchParams) => {
      verbrauchtRef.current = key;
      setSearchParams(naechste, { replace: true });
    };
    return {
      verbraucht: () => verbrauchtRef.current === key,
      weiter,
      raeume: (...namen: string[]) => {
        // Klonen statt in-place mutieren: dieselbe Instanz lesen Render und andere Effekte.
        const naechste = new URLSearchParams(searchParams);
        for (const name of namen) naechste.delete(name);
        weiter(naechste);
      },
    };
  }, [key, searchParams, setSearchParams]);
}
