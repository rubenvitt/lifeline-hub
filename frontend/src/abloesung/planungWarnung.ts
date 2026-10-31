import type {
  AbloesungPlanungEntfallen,
  AbloesungPlanungWarnung,
  PlanungEntfallenGrund,
} from '../api/types';
import { type AnzeigeKonventionen } from '../anzeige/format';
import { zeitKurz } from '../anzeige/zeitDarstellung';

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
        ? `${w.einheit_name} steht selbst im Einsatz seit ${zeitKurz(w.seit_at, konv)}`
        : `${w.einheit_name} steht selbst im Einsatz`;
  }
}

const ENTFALLEN_PARTIZIP: Record<PlanungEntfallenGrund, string> = {
  aufloesung: 'aufgelöst',
  entlassung: 'entlassen',
};

/**
 * Vermerk einer entfallenen Planung an der Karte (LLH-1309, Spec `kraefte-abloesung` „Planung
 * entfällt“): „Planung entfallen · 2. Rettungsstaffel aufgelöst“ bzw. „… entlassen“. Ob er gilt
 * (laufend, kein Ablöser), entscheidet der Server.
 */
export function planungEntfallenText(v: AbloesungPlanungEntfallen): string {
  return `Planung entfallen · ${v.einheit_name} ${ENTFALLEN_PARTIZIP[v.grund]}`;
}
