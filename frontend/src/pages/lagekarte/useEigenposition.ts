import { useEffect, useRef, useState } from 'react';

/**
 * Eigenposition auf der Lagekarte (LFH-712). Der Standort bleibt auf dem Gerät: kein Request,
 * kein `localStorage`, kein Zustand über diesen Hook hinaus — ein Neuladen beginnt ausgeschaltet
 * (Spec `lagekarte-eigenposition`, „Standort verlässt das Gerät nicht").
 */

export type EigenpositionVerfuegbarkeit = 'bereit' | 'unsicher' | 'fehlt';

export interface Eigenposition {
  lat: number;
  lon: number;
  /** Radius in Metern, wie das Gerät ihn meldet. */
  genauigkeit: number;
}

/** Sperrgrund je Verfügbarkeit, als Text am Knopf (Popover und `aria-describedby`). */
export const EIGENPOSITION_SPERRGRUND: Record<
  Exclude<EigenpositionVerfuegbarkeit, 'bereit'>,
  string
> = {
  // Klartext-HTTP über eine IP oder einen Hostnamen: ohne sicheren Kontext gibt der Browser
  // keinen Standort heraus (`docs/betrieb/packaging.md`, sicherer Kontext).
  unsicher: 'Standort nur über eine sichere Verbindung (https) verfügbar.',
  fehlt: 'Dieses Gerät oder dieser Browser liefert keinen Standort.',
};

const MELDUNG_VERWEIGERT =
  'Standortzugriff verweigert – im Browser für diese Seite freigeben, dann erneut einschalten.';
const MELDUNG_KEIN_STANDORT = 'Kein Standort ermittelbar.';

/**
 * Gelesen bei jedem Aufruf, nicht einmal gemerkt: beides kann sich zur Laufzeit nicht ändern,
 * aber ein Test stellt es zwischen zwei Renderings um. `localhost` ist ein sicherer Kontext.
 */
export function eigenpositionVerfuegbarkeit(): EigenpositionVerfuegbarkeit {
  if (!window.isSecureContext) return 'unsicher';
  return typeof navigator !== 'undefined' && navigator.geolocation ? 'bereit' : 'fehlt';
}

export function useEigenposition({
  onFehler,
  onErsterFix,
}: {
  /** Meldung, wenn die Standortermittlung scheitert; der Hook schaltet dabei aus. */
  onFehler: (text: string) => void;
  /** Erster Standort nach dem Einschalten — die Seite fliegt einmal hin, danach nicht mehr. */
  onErsterFix: (position: Eigenposition) => void;
}) {
  const verfuegbarkeit = eigenpositionVerfuegbarkeit();
  const [an, setAn] = useState(false);
  const [position, setPosition] = useState<Eigenposition | null>(null);
  // Die Rückrufe der Seite sind je Render neu; die Uhr soll trotzdem nur am Schalter hängen.
  const rueckrufe = useRef({ onFehler, onErsterFix });
  rueckrufe.current = { onFehler, onErsterFix };

  const bereit = verfuegbarkeit === 'bereit';
  useEffect(() => {
    if (!an || !bereit) return;
    // Je Einschalten neu: erst der erste Standort DIESES Laufs fliegt an, und ein Aussetzer
    // danach behält die letzte Position, statt den Punkt verschwinden zu lassen.
    let hatFix = false;
    // Die Quelle einmal festhalten: das Aufräumen räumt genau die Uhr, die hier gestellt wurde.
    const geo = navigator.geolocation;
    const aus = (text: string) => {
      setAn(false);
      setPosition(null);
      rueckrufe.current.onFehler(text);
    };
    const id = geo.watchPosition(
      (p) => {
        const neu: Eigenposition = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          genauigkeit: p.coords.accuracy,
        };
        setPosition(neu);
        if (!hatFix) {
          hatFix = true;
          rueckrufe.current.onErsterFix(neu);
        }
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) aus(MELDUNG_VERWEIGERT);
        else if (!hatFix) aus(MELDUNG_KEIN_STANDORT);
      },
      // Endliche Frist: sonst wartete ein Gerät ohne Ortung stumm für immer. 15 s tragen auch
      // einen Kaltstart des GPS am Tablet; ein älterer Wert von bis zu 5 s ist gut genug.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
    // Aufräumen beim Ausschalten UND beim Aushängen — unter StrictMode hängt der Effekt
    // doppelt ein, eine zweite Uhr darf dabei nicht liegen bleiben.
    return () => geo.clearWatch(id);
  }, [an, bereit]);

  const umschalten = () => {
    if (!bereit) return;
    if (an) setPosition(null);
    setAn(!an);
  };

  return { verfuegbarkeit, an, position, umschalten };
}
