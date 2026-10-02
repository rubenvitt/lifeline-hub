import { useEffect, useRef, useState } from 'react';

/**
 * Eigenposition auf der Lagekarte. Der Standort bleibt auf dem Gerät: kein Request, kein
 * `localStorage`, kein Zustand über diesen Hook hinaus — ein Neuladen beginnt ausgeschaltet.
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
  // Klartext-HTTP über eine IP oder einen Hostnamen: ohne sicheren Kontext gibt der Browser keinen
  // Standort heraus (`docs/betrieb/packaging.md`).
  unsicher: 'Standort nur über eine sichere Verbindung (https) verfügbar.',
  fehlt: 'Dieses Gerät oder dieser Browser liefert keinen Standort.',
};

const MELDUNG_VERWEIGERT =
  'Standortzugriff verweigert – im Browser für diese Seite freigeben, dann erneut einschalten.';
const MELDUNG_KEIN_STANDORT = 'Kein Standort ermittelbar.';

/**
 * Bei jedem Aufruf gelesen: zur Laufzeit ändert sich beides nicht, aber ein Test stellt es um.
 * `localhost` ist ein sicherer Kontext.
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
  /**
   * Erster Standort nach dem Einschalten — die Seite fliegt höchstens einmal hin, danach nicht
   * mehr; wurde seit dem Einschalten bedient, gar nicht (LFH-766, `LagekartePage`).
   */
  onErsterFix: (position: Eigenposition) => void;
}) {
  const verfuegbarkeit = eigenpositionVerfuegbarkeit();
  const [an, setAn] = useState(false);
  const [position, setPosition] = useState<Eigenposition | null>(null);
  // Die Rückrufe der Seite sind je Render neu; die Uhr hängt trotzdem nur am Schalter.
  const rueckrufe = useRef({ onFehler, onErsterFix });
  rueckrufe.current = { onFehler, onErsterFix };

  const bereit = verfuegbarkeit === 'bereit';
  useEffect(() => {
    if (!an || !bereit) return;
    // Je Einschalten neu: erst der erste Standort dieses Laufs fliegt an, und ein Aussetzer danach
    // behält die letzte Position.
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
      // Endliche Frist, sonst wartete ein Gerät ohne Ortung stumm. 15 s tragen einen GPS-Kaltstart
      // am Tablet; ein bis zu 5 s alter Wert ist gut genug.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
    // Aufräumen beim Ausschalten und beim Aushängen — unter StrictMode darf keine zweite Uhr liegen
    // bleiben.
    return () => geo.clearWatch(id);
  }, [an, bereit]);

  const umschalten = () => {
    if (!bereit) return;
    if (an) setPosition(null);
    setAn(!an);
  };

  return { verfuegbarkeit, an, position, umschalten };
}
