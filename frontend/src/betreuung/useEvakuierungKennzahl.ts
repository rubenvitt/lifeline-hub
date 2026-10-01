import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeBetreuung } from '../api/betreuung';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { darfZaehlerZeigen } from '../einsatz/useModulZaehler';
import { evakuierungKennzahl, type EvakuierungKennzahl } from './evakuierungKennzahl';

/**
 * Zustand der Kennzahl „Evakuiert N · von M geplant". Vier Fälle, die ein Aufrufer
 * auseinanderhalten MUSS:
 *
 *  - `aus` — Modul ausgeblendet oder gesperrt (oder ungültige Einsatz-ID). Es wird NICHT
 *    geladen: ein 403 wäre Rauschen und ein Seitenkanal.
 *  - `laden` — der erste Abruf läuft, oder der Aufrufer meldet `bereit: false`.
 *  - `fehler` — der Abruf ist gescheitert, auch wenn ältere Daten im Cache liegen. „Fehler" ist
 *    NIE „keine Kennzahl".
 *  - `daten` — `kennzahl` ist die Kennzahl oder `null` (keine geplante Evakuierung).
 */
export type EvakuierungKennzahlZustand =
  | { zustand: 'aus' }
  | { zustand: 'laden' }
  | { zustand: 'fehler'; fehler: unknown }
  | { zustand: 'daten'; kennzahl: EvakuierungKennzahl | null };

interface Args {
  einsatzId: number;
  /** Modul-Freigaben des Servers (LFH-669); `undefined` heißt „noch unbekannt“ und gibt nichts frei. */
  freigaben?: ModulFreigaben;
  /**
   * `false`, solange die Modul-Freigaben laden: dann gilt `laden` OHNE Abruf — sonst stünde bis
   * zur Antwort `aus` statt `laden` in der Zelle.
   */
  bereit?: boolean;
}

/**
 * Kennzahl aus der Betreuungs-Übersicht, gelesen vom Lage-Dashboard. DIESELBE Query wie
 * Modulseite und Modulzähler; gegatet über `darfZaehlerZeigen('betreuung', …)` wie der Zähler
 * in der Navigation.
 */
export function useEvakuierungKennzahl({
  einsatzId,
  freigaben,
  bereit = true,
}: Args): EvakuierungKennzahlZustand {
  const aktiv = Number.isFinite(einsatzId) && darfZaehlerZeigen('betreuung', freigaben);
  const query = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: bereit && aktiv,
  });
  const { isError, error, isSuccess, data } = query;
  // Identitätsstabil: das Lage-Dashboard reicht den Zustand in ein `useMemo` weiter.
  return useMemo((): EvakuierungKennzahlZustand => {
    if (!bereit) return { zustand: 'laden' };
    if (!aktiv) return { zustand: 'aus' };
    if (isError) return { zustand: 'fehler', fehler: error };
    if (!isSuccess) return { zustand: 'laden' };
    return { zustand: 'daten', kennzahl: evakuierungKennzahl(data.bezirke) };
  }, [bereit, aktiv, isError, error, isSuccess, data]);
}
