import { alsOrtszeit } from '../anzeige/zeitEingabe';

/**
 * Server-Zeitpunkt (UTC, mit oder ohne Zone) in Ortszeit „TT.MM.JJJJ HH:mm“. Die Verwaltung liegt
 * außerhalb eines Einsatzes und hat keine Anzeige-Konventionen; Vorbild `admin/DemoDatenPage.tsx`.
 */
export function ortszeit(s: string | null | undefined): string {
  return alsOrtszeit(s)?.format('DD.MM.YYYY HH:mm') ?? '';
}
