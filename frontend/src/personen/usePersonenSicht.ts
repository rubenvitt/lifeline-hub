import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { parsePersonenSicht } from '../routing/deeplinks';
import { useAdressAenderung } from '../routing/useLinkAuftrag';
import { SICHT_VORGABE, type PersonenSicht } from './personenFilter';

/** Die Sicht aus den Parametern; Fehlendes und Unbekanntes ist Vorgabe. */
function liesSicht(params: URLSearchParams): PersonenSicht {
  const gelesen = parsePersonenSicht(params);
  return {
    ansicht: gelesen.ansicht ?? SICHT_VORGABE.ansicht,
    filter: gelesen.filter ?? SICHT_VORGABE.filter,
    nurLuecken: params.get('luecken') === '1',
    abgeschlossen: gelesen.abgeschlossen ?? SICHT_VORGABE.abgeschlossen,
  };
}

/**
 * Die Sicht der Betroffenen als Zustand der Adresse (LLH-1826, Entwurf D4): `ansicht`, `filter`,
 * `luecken=1`, `abgeschlossen=1`, je mit `replace`; die Vorgabe ({@link SICHT_VORGABE}) steht nicht
 * in der Adresse. Die Sprungmarken „Patienten“ und „Vermisste“ sind gewöhnliche Adressen: sie
 * zeigen genau ihre Sicht, was sie nicht nennen, gilt als Vorgabe. Die Suche bleibt aus der
 * Adresse (Namen von Betroffenen, `frontend/src/personen/AGENTS.md`).
 */
export function usePersonenSicht(): [
  PersonenSicht,
  (aenderung: (alt: PersonenSicht) => PersonenSicht) => void,
] {
  const [params] = useSearchParams();
  const aendereAdresse = useAdressAenderung();
  const sicht = useMemo(() => liesSicht(params), [params]);
  // Stabiler Setter: Effekte und Rückrufe der Seite hängen nicht an jeder Navigation. Die Änderung
  // rechnet vom ausstehenden Stand (`useAdressAenderung`), zwei Änderungen im selben Zug bauen so
  // aufeinander auf.
  const aendereRef = useRef(aendereAdresse);
  useLayoutEffect(() => {
    aendereRef.current = aendereAdresse;
  });
  const setze = useCallback((aenderung: (alt: PersonenSicht) => PersonenSicht) => {
    aendereRef.current((p) => {
      const alt = liesSicht(p);
      const neu = aenderung(alt);
      const schreibe = (name: string, wert: string | undefined) => {
        if (wert === undefined) p.delete(name);
        else p.set(name, wert);
      };
      schreibe('ansicht', neu.ansicht === SICHT_VORGABE.ansicht ? undefined : neu.ansicht);
      schreibe('filter', neu.filter === SICHT_VORGABE.filter ? undefined : neu.filter);
      schreibe('luecken', neu.nurLuecken ? '1' : undefined);
      schreibe('abgeschlossen', neu.abgeschlossen ? '1' : undefined);
    });
  }, []);
  return [sicht, setze];
}
