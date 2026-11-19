import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { GEDAECHTNIS_ENTPRELLUNG_MS } from '../components/listenGedaechtnis';
import { parseRouteId } from './deeplinks';
import { useAdressAenderung } from './useLinkAuftrag';

/**
 * Ansicht und Filter einer Seite als Zustand der Adresse (LLH-1826, Entwurf
 * `docs/superpowers/specs/2026-11-19-yht1wcsw-ansicht-filter-rueckweg-design.md` D1/D2; Regel
 * `frontend/AGENTS.md`, „Ansicht und Filter gehören in die Adresse“).
 *
 * Jeder Hook liest EINEN Query-Parameter und schreibt ihn mit `replace`: ein Filterwechsel legt
 * keinen Verlaufseintrag an, Zurück führt aus der Seite. Die Vorgabe steht nicht in der Adresse,
 * fremde Parameter bleiben. Ein unbekannter Wert gilt als Vorgabe. Es gibt kein
 * Sitzungsgedächtnis: wer über das Modulmenü neu einsteigt, beginnt mit der Vorgabe.
 *
 * Mehrere Setter im selben Zug (auch neben `useLinkAuftrag`) bauen aufeinander auf
 * (`useAdressAenderung`): keiner stellt zurück, was ein anderer eben geändert hat.
 */

/** Neue Instanz mit gesetztem bzw. (bei `undefined` oder `''`) gelöschtem Parameter. */
export function setzeParam(
  alt: URLSearchParams,
  schluessel: string,
  wert: string | undefined,
): URLSearchParams {
  const neu = new URLSearchParams(alt);
  if (wert === undefined || wert === '') neu.delete(schluessel);
  else neu.set(schluessel, wert);
  return neu;
}

/** Der Wert, wenn er im exhaustiven Record steht; sonst `undefined` (ganz verworfen). */
export function liesErlaubt<T extends string>(
  params: URLSearchParams,
  schluessel: string,
  erlaubt: Record<T, true>,
): T | undefined {
  const wert = params.get(schluessel);
  return wert !== null && Object.prototype.hasOwnProperty.call(erlaubt, wert)
    ? (wert as T)
    : undefined;
}

/** Schreiber eines Parameters mit `replace`, verträglich mit anderen Schreibern im selben Zug. */
function useSchreibe(schluessel: string): (wert: string | undefined) => void {
  const aendereAdresse = useAdressAenderung();
  return useCallback(
    (wert: string | undefined) =>
      aendereAdresse((naechste) => {
        if (wert === undefined || wert === '') naechste.delete(schluessel);
        else naechste.set(schluessel, wert);
      }),
    [aendereAdresse, schluessel],
  );
}

/** Ein Wert aus einer festen Menge; `vorgabe` löscht den Parameter. */
export function useAdressWert<T extends string>(
  schluessel: string,
  erlaubt: Record<T, true>,
  vorgabe: T,
): [T, (neu: T) => void] {
  const [params] = useSearchParams();
  const schreibe = useSchreibe(schluessel);
  const wert = liesErlaubt(params, schluessel, erlaubt) ?? vorgabe;
  const setze = useCallback(
    (neu: T) => schreibe(neu === vorgabe ? undefined : neu),
    [schreibe, vorgabe],
  );
  return [wert, setze];
}

/**
 * Ein Wert aus einer festen Menge OHNE feste Vorgabe (die Seite leitet sie aus Daten ab): jede
 * ausdrückliche Wahl wird geschrieben, auch wenn sie gerade der abgeleiteten Vorgabe entspricht
 * (Entwurf D3a, Befehle).
 */
export function useAdressWahl<T extends string>(
  schluessel: string,
  erlaubt: Record<T, true>,
): [T | undefined, (neu: T | undefined) => void] {
  const [params] = useSearchParams();
  const schreibe = useSchreibe(schluessel);
  return [liesErlaubt(params, schluessel, erlaubt), schreibe];
}

/** Ein Schalter: `=1` oder der Parameter fehlt. */
export function useAdressSchalter(schluessel: string): [boolean, (an: boolean) => void] {
  const [params] = useSearchParams();
  const schreibe = useSchreibe(schluessel);
  const setze = useCallback((an: boolean) => schreibe(an ? '1' : undefined), [schreibe]);
  return [params.get(schluessel) === '1', setze];
}

/** Eine Datenbank-Kennung; eine ungültige gilt als nicht gesetzt (`parseRouteId`). */
export function useAdressKennung(
  schluessel: string,
): [number | undefined, (id: number | undefined) => void] {
  const [params] = useSearchParams();
  const schreibe = useSchreibe(schluessel);
  const setze = useCallback(
    (id: number | undefined) => schreibe(id === undefined ? undefined : String(id)),
    [schreibe],
  );
  return [parseRouteId(params.get(schluessel) ?? undefined) ?? undefined, setze];
}

/**
 * Freitext: das Feld hält seinen Text selbst und schreibt ihn entprellt
 * (`GEDAECHTNIS_ENTPRELLUNG_MS`) in die Adresse. Ändert sich der Parameter von außen (Zurück,
 * Link), setzt der Text neu auf (`frontend/AGENTS.md`, „Filterleiste nur bei fremder Änderung
 * neu aufsetzen“). Nicht für die Personensuche: sie trägt Namen und bleibt aus der Adresse.
 */
export function useAdressSuche(schluessel = 'q'): [string, (text: string) => void] {
  const [params] = useSearchParams();
  const schreibe = useSchreibe(schluessel);
  const adresse = params.get(schluessel) ?? '';
  const [text, setText] = useState(adresse);
  const [gesehen, setGesehen] = useState(adresse);
  // Der Text, den dieser Hook zuletzt selbst geschrieben hat: dessen Echo ist keine fremde Änderung.
  const geschrieben = useRef(adresse);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (adresse !== gesehen) {
    setGesehen(adresse);
    if (adresse !== geschrieben.current) {
      clearTimeout(timer.current);
      geschrieben.current = adresse;
      setText(adresse);
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const setze = useCallback(
    (neu: string) => {
      setText(neu);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        geschrieben.current = neu;
        schreibe(neu);
      }, GEDAECHTNIS_ENTPRELLUNG_MS);
    },
    [schreibe],
  );
  return [text, setze];
}
