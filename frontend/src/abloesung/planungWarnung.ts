import type { AbloesungPlanungWarnung } from '../api/types';
import { formatZeitKurz, type AnzeigeKonventionen } from '../anzeige/format';

/**
 * Text einer Warnung beim Planen der ablösenden Einheit (LLH-1131, Spec `kraefte-abloesung`
 * „Plausibilität beim Planen“): „2. Rettungsstaffel schon für Schicht Florian 1 geplant“ bzw.
 * „2. Rettungsstaffel steht selbst im Einsatz seit 1340“. Die Planung gilt trotzdem; der Server
 * liefert die Warnungen mit der Schicht (`planung_warnungen`).
 */
export function planungWarnungText(w: AbloesungPlanungWarnung, konv: AnzeigeKonventionen): string {
  switch (w.art) {
    case 'schon_geplant':
      return `${w.einheit_name} schon für Schicht ${w.abloesung_einheit_name ?? ''} geplant`.trim();
    case 'im_einsatz':
      return w.seit_at
        ? `${w.einheit_name} steht selbst im Einsatz seit ${formatZeitKurz(w.seit_at, konv)}`
        : `${w.einheit_name} steht selbst im Einsatz`;
  }
}
