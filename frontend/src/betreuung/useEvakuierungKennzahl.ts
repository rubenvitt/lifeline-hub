import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeBetreuung } from '../api/betreuung';
import { einsatzKeys } from '../api/queryKeys';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
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
  benutzer: BenutzerAnzeige | null;
  overrides?: ModulOverrides;
  /**
   * `false`, solange Benutzer oder Modul-Overrides laden: dann gilt `laden` OHNE Abruf — ohne
   * Overrides hielte `darfZaehlerZeigen` ein ausgeblendetes Modul für sichtbar (403).
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
  benutzer,
  overrides,
  bereit = true,
}: Args): EvakuierungKennzahlZustand {
  const aktiv = Number.isFinite(einsatzId) && darfZaehlerZeigen('betreuung', benutzer, overrides);
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
