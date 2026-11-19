import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams, type Location } from 'react-router';

export interface LinkAuftrag {
  /** Hat dieser Auftrag den aktuellen Verlaufseintrag schon verbraucht? */
  verbraucht: () => boolean;
  /**
   * Verbraucht den Verlaufseintrag und ändert die Adresse (`replace`): `aendere` bekommt die
   * Parameter, auf die sich alle Aufträge dieses Eintrags einigen, und ändert sie in place. Auch ein
   * Schritt, der den Auftrag stehen lässt (etwa ein Ansichtswechsel davor), läuft hierüber: der
   * nächste Eintrag trägt den Auftrag dann neu.
   */
  weiter: (aendere: (naechste: URLSearchParams) => void) => void;
  /** Verbraucht den Verlaufseintrag und räumt die genannten Parameter (`replace`). */
  raeume: (...namen: string[]) => void;
}

/**
 * Die Adresse, zu der die Aufträge eines Verlaufseintrags zuletzt navigiert haben, bis der Router
 * den neuen Eintrag rendert. Schlüssel ist das Location-Objekt: dasselbe für alle Renders eines
 * Eintrags, je Router ein eigenes (der erste Eintrag heißt in jedem Router `default`).
 */
const ausstehend = new WeakMap<Location, URLSearchParams>();

/**
 * Ändert die Parameter der Adresse mit `replace`, aufbauend auf dem, was andere Schreiber DESSELBEN
 * Verlaufseintrags schon geändert haben (`ausstehend`): `setSearchParams` liest sonst den Stand des
 * Renders, und ein zweiter Schreiber im selben Zug stellte zurück, was der erste geräumt hat
 * (LLH-1530). Teilen sich Link-Aufträge und Werte der Adresse (`routing/useAdressWert.ts`, LLH-1826).
 */
export function useAdressAenderung(): (aendere: (naechste: URLSearchParams) => void) => void {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  return useCallback(
    (aendere: (naechste: URLSearchParams) => void) => {
      // Klonen statt in-place mutieren: dieselbe Instanz lesen Render und andere Effekte.
      const basis = ausstehend.get(location) ?? searchParams;
      const naechste = new URLSearchParams(basis);
      aendere(naechste);
      ausstehend.set(location, naechste);
      // Nichts geändert: keine Navigation (ein Listenstand meldet oft denselben Stand erneut).
      if (naechste.toString() === basis.toString()) return;
      setSearchParams(naechste, { replace: true });
    },
    [location, searchParams, setSearchParams],
  );
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
 * Ihre Räumungen bauen aufeinander auf (`ausstehend`): `setSearchParams` rechnet immer vom Stand
 * des Renders aus, der zweite Replace stellte sonst den Parameter des ersten wieder her.
 */
export function useLinkAuftrag(): LinkAuftrag {
  const location = useLocation();
  const aendereAdresse = useAdressAenderung();
  const verbrauchtRef = useRef<string | null>(null);
  /*
   * StrictMode hängt eine frische Instanz zum Test einmal aus und wieder ein (nur Entwicklung, auch
   * im e2e-Lauf gegen den Vite-Server): alle Effekte laufen ein zweites Mal, mit den Werten DESSELBEN
   * Renders. Andere Effekte setzen dabei Zustand erneut, den der Auftrag im ersten Lauf überschrieben
   * hat (etwa die Vorauswahl einer `ListeDetail`, die den Sprung räumt, LLH-1530). Ein Aushängen gibt
   * den Eintrag deshalb frei: der Auftrag läuft im zweiten Durchgang wie jeder andere Effekt mit.
   * Gegen geänderte Abhängigkeiten bleibt er geschützt, die hängen nichts aus.
   */
  useEffect(
    () => () => {
      verbrauchtRef.current = null;
    },
    [],
  );
  return useMemo(() => {
    const weiter = (aendere: (naechste: URLSearchParams) => void) => {
      verbrauchtRef.current = location.key;
      aendereAdresse(aendere);
    };
    return {
      verbraucht: () => verbrauchtRef.current === location.key,
      weiter,
      raeume: (...namen: string[]) =>
        weiter((naechste) => {
          for (const name of namen) naechste.delete(name);
        }),
    };
  }, [location, aendereAdresse]);
}
