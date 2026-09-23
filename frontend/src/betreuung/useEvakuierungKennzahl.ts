import { useQuery } from '@tanstack/react-query';
import { ladeBetreuung } from '../api/betreuung';
import { einsatzKeys } from '../api/queryKeys';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { darfZaehlerLaden } from '../einsatz/useModulZaehler';
import { evakuierungKennzahl, type EvakuierungKennzahl } from './evakuierungKennzahl';

/**
 * Zustand der Kennzahl „Evakuiert N · von M geplant" (LFH-639, design.md D9). Vier Fälle,
 * die ein Aufrufer auseinanderhalten MUSS:
 *
 *  - `aus` — das Modul ist ausgeblendet oder rollen-gesperrt (oder die Einsatz-ID ist
 *    ungültig). Es wird NICHT geladen: das Backend antwortete mit 403, und ein Zähler, der
 *    trotzdem fragt, wäre 403-Rauschen und ein Seitenkanal. Kein Fehler, keine Kennzahl.
 *  - `laden` — der erste Abruf läuft.
 *  - `fehler` — der Abruf ist gescheitert. Auch dann, wenn ältere Daten im Cache liegen: eine
 *    Kennzahl aus einem Stand, von dem man nicht weiß, ob er noch gilt, wäre eine stille
 *    Behauptung. „Fehler" ist NIE „keine Kennzahl" (Spec, Requirement „Kennzahl …").
 *  - `daten` — `kennzahl` ist die Kennzahl oder `null`, wenn es keine geplante Evakuierung gibt.
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
}

/**
 * Kennzahl aus der Betreuungs-Übersicht, fertig zum Einsetzen (LFH-640/LFH-607). Liest
 * DIESELBE Query wie Modulseite und Modulzähler (`einsatzKeys.betreuung`) — ein Abruf, ein
 * Cache-Fach, und das Live-Ereignis `betreuung` frischt alle drei auf.
 *
 * Gegatet über `darfZaehlerLaden('betreuung', …)`: dieselbe Rechteprüfung wie der Zähler in
 * der Navigation, nicht eine zweite, die auseinanderlaufen könnte.
 */
export function useEvakuierungKennzahl({
  einsatzId,
  benutzer,
  overrides,
}: Args): EvakuierungKennzahlZustand {
  const aktiv = Number.isFinite(einsatzId) && darfZaehlerLaden('betreuung', benutzer, overrides);
  const query = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: aktiv,
  });
  if (!aktiv) return { zustand: 'aus' };
  if (query.isError) return { zustand: 'fehler', fehler: query.error };
  if (!query.isSuccess) return { zustand: 'laden' };
  return { zustand: 'daten', kennzahl: evakuierungKennzahl(query.data.bezirke) };
}
