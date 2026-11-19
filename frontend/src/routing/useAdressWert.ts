import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router';
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

/**
 * Schreiber eines Parameters mit `replace`, verträglich mit anderen Schreibern im selben Zug.
 * Stabil über Navigationen: Effekte, die ihn nutzen, hängen nicht an jeder Adressänderung.
 */
function useSchreibe(schluessel: string): (wert: string | undefined) => void {
  const aendereAdresse = useAdressAenderung();
  const aendereRef = useRef(aendereAdresse);
  useLayoutEffect(() => {
    aendereRef.current = aendereAdresse;
  });
  return useCallback(
    (wert: string | undefined) =>
      aendereRef.current((naechste) => {
        if (wert === undefined || wert === '') naechste.delete(schluessel);
        else naechste.set(schluessel, wert);
      }),
    [schluessel],
  );
}

/** Ein Wert aus einer festen Menge; `vorgabe` löscht den Parameter. */
export function useAdressWert<T extends string>(
  schluessel: string,
  erlaubt: Record<T, true>,
  vorgabe: NoInfer<T>,
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

/**
 * Ein kurzer Text ohne feste Menge (etwa `abschnitt:3` des Empfängerfilters), sofort geschrieben.
 * `gueltig` verwirft, was die Seite nicht lesen kann. Freitext nimmt {@link useAdressSuche}.
 */
export function useAdressText(
  schluessel: string,
  gueltig: (wert: string) => boolean = () => true,
): [string | undefined, (wert: string | undefined) => void] {
  const [params] = useSearchParams();
  const schreibe = useSchreibe(schluessel);
  const wert = params.get(schluessel);
  return [wert !== null && wert !== '' && gueltig(wert) ? wert : undefined, schreibe];
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

  // Ein anderer Verlaufseintrag (Link, Zurück, anderer Einsatz auf derselben Route) verwirft einen
  // noch nicht geschriebenen Begriff: er gehörte zur vorigen Adresse. Eine eigene Änderung per
  // `replace` (ein Filter daneben) lässt ihn stehen.
  const location = useLocation();
  const navigationType = useNavigationType();
  const vorigerEintrag = useRef(location.key);
  useEffect(() => {
    if (location.key === vorigerEintrag.current) return;
    vorigerEintrag.current = location.key;
    if (navigationType === 'REPLACE') return;
    clearTimeout(timer.current);
    timer.current = undefined;
    geschrieben.current = adresse;
    setText(adresse);
    // Getaktet über den Eintrag; Adresse und Art gelten zu diesem Zeitpunkt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const setze = useCallback(
    (neu: string) => {
      setText(neu);
      clearTimeout(timer.current);
      if (neu === '') {
        // Leeren wirkt sofort (Zurücksetzen, ✕ im Feld): ein Weggehen danach brächte den Begriff
        // sonst mit dem Zurück wieder.
        geschrieben.current = '';
        schreibe(undefined);
        return;
      }
      timer.current = setTimeout(() => {
        geschrieben.current = neu;
        schreibe(neu);
      }, GEDAECHTNIS_ENTPRELLUNG_MS);
    },
    [schreibe],
  );
  return [text, setze];
}

/**
 * Wie {@link useAdressWert}, aber für eine Ansicht, deren Wechsel eine offene Bearbeitung aushängt
 * (LLH-1415): die eigene Wahl geht über `nachRueckfrage`, und eine FREMDE Änderung der Adresse (eine
 * Sprungmarke auf demselben Pfad, `useBlocker` hält sie nicht an) wird erst nach der Rückfrage
 * übernommen. „Bleiben“ führt die Adresse auf die gezeigte Ansicht zurück. Gezeigt wird der
 * bestätigte Wert, nicht der rohe Adresswert. Der dritte Wert setzt ohne Rückfrage, für einen
 * Wechsel, den die Seite selbst verantwortet (ein Deeplink, der eine Zeile braucht).
 */
export function useAdressWertNachRueckfrage<T extends string>(
  schluessel: string,
  erlaubt: Record<T, true>,
  vorgabe: NoInfer<T>,
  nachRueckfrage: (wechsel: () => void) => void,
): [T, (neu: T) => void, (neu: T) => void] {
  const [adresse, setzeAdresse] = useAdressWert(schluessel, erlaubt, vorgabe);
  const [gezeigt, setGezeigt] = useState(adresse);
  const vorher = useRef(adresse);

  useEffect(() => {
    if (adresse === vorher.current) return;
    vorher.current = adresse;
    if (adresse === gezeigt) return;
    // Fremde Änderung: die Adresse bleibt bei der gezeigten Ansicht, bis die Rückfrage entscheidet.
    setzeAdresse(gezeigt);
    nachRueckfrage(() => {
      setGezeigt(adresse);
      setzeAdresse(adresse);
    });
    // Getaktet nur über den Adresswert; die übrigen Werte gelten zum Zeitpunkt der Änderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adresse]);

  const setzeSofort = useCallback(
    (neu: T) => {
      setGezeigt(neu);
      setzeAdresse(neu);
    },
    [setzeAdresse],
  );
  const setze = useCallback(
    (neu: T) => nachRueckfrage(() => setzeSofort(neu)),
    [nachRueckfrage, setzeSofort],
  );
  return [gezeigt, setze, setzeSofort];
}
