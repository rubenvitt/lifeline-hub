import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { parseBerichtAuswahl } from '../../routing/deeplinks';
import { AUSWAHL_PARAM, auswahlParam, auswahlSchluessel, type BlockSchluessel } from './auswahl';

/**
 * Die Auswahl der Blöcke, gespiegelt in `?bloecke=` (LFH-902, design.md D1/D4).
 *
 * Die Adresse allein reicht nicht als Zustand: `setSearchParams` navigiert, und bis die Navigation
 * gerendert ist, liest ein zweiter schneller Klick noch die alte Adresse und überschriebe den
 * ersten (im e2e beobachtet: Bilanz, Lage, Anlage nacheinander — „Lage“ ging verloren). Deshalb
 * gilt bis dahin die zuletzt gewünschte Auswahl. Kommt eine Adresse an, die keiner eigenen
 * Änderung entspricht (Sprungpalette, Link), gewinnt sie.
 */
export function useBerichtAuswahl(): [BlockSchluessel[], (neu: BlockSchluessel[]) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const ausUrl = useMemo(() => parseBerichtAuswahl(searchParams), [searchParams]);
  const urlSchluessel = auswahlSchluessel(ausUrl);

  // Eigene, noch nicht in der Adresse angekommene Änderungen, älteste zuerst.
  const [ausstehend, setAusstehend] = useState<BlockSchluessel[][]>([]);
  const [gesehen, setGesehen] = useState(urlSchluessel);
  let offen = ausstehend;
  if (urlSchluessel !== gesehen) {
    // Zustand an eine neue Adresse anpassen (Muster „state from props“, kein Effekt): angekommene
    // eigene Änderungen fallen weg, eine fremde Adresse verwirft alle.
    const i = ausstehend.findIndex((a) => auswahlSchluessel(a) === urlSchluessel);
    offen = i >= 0 ? ausstehend.slice(i + 1) : [];
    setGesehen(urlSchluessel);
    setAusstehend(offen);
  }
  const auswahl = offen.length > 0 ? offen[offen.length - 1] : ausUrl;

  const setzen = useCallback(
    (neu: BlockSchluessel[]) => {
      setAusstehend((alt) => [...alt, neu]);
      const params = new URLSearchParams(searchParams);
      const wert = auswahlParam(neu);
      if (wert) params.set(AUSWAHL_PARAM, wert);
      else params.delete(AUSWAHL_PARAM);
      // `replace`: der Zurück-Knopf springt nicht durch jede Häkchenänderung.
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return [auswahl, setzen];
}
