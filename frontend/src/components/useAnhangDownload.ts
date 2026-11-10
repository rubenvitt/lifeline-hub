import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { ApiError, apiDatei } from '../api/client';
import { WIRD_GEHOLT_WORT, istAnhangWirdGeholt } from '../api/anhangAbruf';
import { einsatzIdAusPfad } from '../api/anhangFassung';
import { useSpiegelAusCache } from '../einsatz/spiegel/useSpiegelAntraege';
import { speichereDatei } from './dateiSpeichern';

/** Ein großer Anhang braucht über eine schmale Leitung mehr als die 15 s eines Abrufs. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

type Stand =
  | { zustand: 'laedt' }
  | { zustand: 'wird_geholt'; takt: number }
  | { zustand: 'fehler'; text: string };

/**
 * Download eines Anhangs am Spiegel (LLH-1492, design.md D8, Spec `einsatz-spiegel`, „Anhänge auf
 * Abruf“). Ohne Spiegel bleibt der native Verweis (`<a href download>`, `DownloadAnker`). Am
 * Spiegel lädt der Klick die Datei erst (`apiDatei`) und bietet sie dann an: der Browser
 * speicherte sonst die 409 „wird geholt“ als Datei. Heißt die Antwort „wird geholt“, steht das
 * Wort am Verweis, und nach dem nächsten Abgleich (neuer Stand des Kopfs) lädt er erneut.
 *
 * `hinweis` steht neben dem Verweis; `onClick` gehört an den Verweis.
 */
export function useAnhangDownload(
  href: string,
  dateiname: string,
): {
  onClick: ((e: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  hinweis: string | null;
} {
  const { spiegel, abgleichTakt } = useSpiegelAusCache(einsatzIdAusPfad(href));
  const [stand, setStand] = useState<Stand | null>(null);

  const laden = useCallback(
    (takt: number) => {
      setStand({ zustand: 'laedt' });
      apiDatei(href, { timeoutMs: DOWNLOAD_TIMEOUT_MS }).then(
        (datei) => {
          setStand(null);
          speichereDatei(datei, dateiname);
        },
        (e: unknown) => {
          if (istAnhangWirdGeholt(e)) setStand({ zustand: 'wird_geholt', takt });
          else
            setStand({
              zustand: 'fehler',
              text: e instanceof ApiError ? e.message : 'nicht geladen',
            });
        },
      );
    },
    [href, dateiname],
  );

  // Nach dem nächsten Abgleich erneut: der Inhalt kann inzwischen da sein.
  const nochmal = stand?.zustand === 'wird_geholt' && stand.takt !== abgleichTakt;
  useEffect(() => {
    if (nochmal) laden(abgleichTakt);
  }, [nochmal, abgleichTakt, laden]);

  if (!spiegel) return { onClick: undefined, hinweis: null };
  return {
    onClick: (e) => {
      e.preventDefault();
      if (stand?.zustand === 'laedt') return;
      laden(abgleichTakt);
    },
    hinweis:
      stand == null
        ? null
        : stand.zustand === 'laedt'
          ? 'lädt'
          : stand.zustand === 'wird_geholt'
            ? WIRD_GEHOLT_WORT
            : stand.text,
  };
}
