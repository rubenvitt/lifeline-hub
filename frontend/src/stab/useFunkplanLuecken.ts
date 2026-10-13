import { useMemo } from 'react';
import type { AbrufZustand } from '../api/abrufZustand';
import { useModulFreigabe } from '../einsatz/useModulFreigabe';
import { useOhneVerbindung } from '../offline/verbindung';
import { baueFernmeldenetz } from './fernmeldeskizze';
import { funkplanLuecken } from './funkplan';
import { countLuecken } from './luecken';
import { useNetzQuellen } from './useNetzQuellen';

/**
 * Die Zahl der Funkplan-Lücken für das Werkzeug „Funkplan“ der Stab-Seite (LLH-1124,
 * `openspec/changes/o5nxgqbl-stab-uebersicht/design.md`, D5). Dieselben Quellen wie Funkplan und
 * Skizzen-Anlage (`useNetzQuellen`, eine Weiche je Quelle), dieselbe Rechnung wie der Kopf des
 * Lücken-Paneels (`countLuecken`): die beiden Zahlen können nicht auseinanderlaufen.
 *
 * Ohne Freigabe des Fernmeldewesens gibt es keine Zahl; dessen Quellen fragt `useNetzQuellen` dann
 * nicht ab, und das Werkzeug steht ohnehin gesperrt oder fehlt.
 */
export function useFunkplanLuecken(einsatzId: number): {
  zustand: AbrufZustand;
  anzahl: number | null;
} {
  const freigabe = useModulFreigabe(einsatzId, 'fernmeldewesen');
  const ohneVerbindung = useOhneVerbindung();
  const q = useNetzQuellen(einsatzId, freigabe, ohneVerbindung);
  const { abschnitte, einheiten, fahrzeuge, besetzung, sprechgruppen, fuehrungsstelle, stellen } =
    q;
  const skizze = q.skizze;
  const freigabeZustand = freigabe.zustand;
  return useMemo(() => {
    if (freigabeZustand !== 'frei') {
      return { zustand: freigabeZustand === 'laden' ? 'laden' : freigabeZustand, anzahl: null };
    }
    const luecken = funkplanLuecken({
      abschnitte,
      einheiten,
      sprechgruppen,
      fuehrungsstelle,
      stellen,
      skizze,
    });
    const netz = baueFernmeldenetz({
      einsatzId,
      abschnitte,
      einheiten,
      fahrzeuge,
      besetzung,
      fuehrungsstelle,
      sprechgruppen,
      stellen,
      skizze,
    });
    return countLuecken(luecken, netz.luecken);
  }, [
    freigabeZustand,
    einsatzId,
    abschnitte,
    einheiten,
    fahrzeuge,
    besetzung,
    fuehrungsstelle,
    sprechgruppen,
    stellen,
    skizze,
  ]);
}
