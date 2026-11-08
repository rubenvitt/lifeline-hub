/**
 * Fälligkeit und Vollzug laut Schichtplan (LLH-1555, Spec `kraefte-abloesung`, „Fälligkeit laut
 * Plan“ und „Vollzug aus dem Plan“). Der Server rechnet alles: ob eine Schicht dem Plan folgt
 * (`faellig_laut_plan`), ihren Folgeblock (`plan_folgeblock`) und die Vorlage des Wechsels
 * (`GET …/plan-vorlage`). Der Client zeigt sie nur und schickt die Vorlage als Vollzug ab.
 */
import type { Dayjs } from 'dayjs';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import type { Abloesung, AbloesungPlanVorlage, VollzugBody } from '../api/types';

/** Eine laufende Schicht, deren Fälligkeit aus dem Schichtplan kommt. */
export function folgtPlan(s: Abloesung): boolean {
  return s.status === 'laufend' && s.faellig_laut_plan;
}

function personenText(n: number): string {
  if (n === 0) return 'niemand eingeteilt';
  return n === 1 ? '1 Person' : `${n} Personen`;
}

/**
 * Die Zeile der Karte an der Stelle des Rhythmus: „Laut Plan · danach 1600–1800 · 3 Personen“,
 * ohne Folgeblock „Laut Plan · Posten endet“. `null`, wenn die Schicht nicht dem Plan folgt.
 */
export function lautPlanText(
  s: Abloesung,
  konv: AnzeigeKonventionen,
  jetzt?: Dayjs | number,
): string | null {
  if (!folgtPlan(s)) return null;
  const b = s.plan_folgeblock;
  if (!b) return 'Laut Plan · Posten endet';
  const zeit = `${zeitKurz(b.von, konv, jetzt)}–${zeitKurz(b.bis, konv, jetzt)}`;
  return `Laut Plan · danach ${zeit} · ${personenText(b.personen)}`;
}

/** Ohne Folgeblock endet der Posten: der Vollzug ist das Abziehen der ganzen Einheit. */
export function postenEndet(v: AbloesungPlanVorlage): boolean {
  return v.folgeblock_id == null;
}

/** Namen einer Liste der Vorlage, „keine“ ohne. */
function namen(liste: readonly { name: string }[]): string {
  return liste.length > 0 ? liste.map((p) => p.name).join(', ') : 'keine';
}

/** Die Zeilen der Vorlage im Dialog; „Fehlt“ nur, wenn jemand fehlt. */
export function vorlageZeilen(v: AbloesungPlanVorlage): { wort: string; text: string }[] {
  const zeilen = [
    { wort: 'Kommt', text: namen(v.kommen) },
    { wort: 'Bleibt', text: namen(v.bleiben) },
    { wort: 'Geht', text: namen(v.gehen) },
  ];
  if (v.fehlen.length > 0) zeilen.push({ wort: 'Fehlt', text: v.fehlen.join(', ') });
  return zeilen;
}

/** Mit der Vorlage kommt jemand oder bleibt jemand; sonst gibt es keinen Wechsel laut Plan. */
export function vorlageWechselt(v: AbloesungPlanVorlage): boolean {
  return !postenEndet(v) && (v.kommen.length > 0 || v.bleiben.length > 0);
}

/**
 * Der Vollzug aus der Vorlage: Kräfte des Einsatzes in `besatzung`, Personen aus dem Plan in
 * `uebernahme`, die Bleibenden und der Folgeblock. Die Einheit des Blocks ist das Ziel; die Einheit
 * der Schicht lässt der Body weg (der Server nimmt sie dann).
 */
export function planVollzugBody(
  s: Abloesung,
  v: AbloesungPlanVorlage,
  zeitpunkt: Dayjs | null | undefined,
): VollzugBody {
  const ziel = (einheit: number) => (einheit === s.einheit_id ? {} : { einheit_id: einheit });
  const besatzung = v.kommen
    .filter((k) => k.personal_id != null)
    .map((k) => ({ personal_id: k.personal_id as number, ...ziel(k.einheit_id) }));
  const uebernahme = v.kommen
    .filter((k) => k.personal_id == null)
    .map((k) =>
      k.stamm_personal_id != null
        ? { stamm_personal_id: k.stamm_personal_id, ...ziel(k.einheit_id) }
        : { plan_helfer_id: k.plan_helfer_id as number, ...ziel(k.einheit_id) },
    );
  return {
    vollzogen_at: zeitpunkt ? alsBackendZeit(zeitpunkt) : undefined,
    art: 'besatzung',
    besatzung,
    ...(uebernahme.length > 0 ? { uebernahme } : {}),
    ...(v.bleiben.length > 0 ? { bleiben: v.bleiben.map((p) => p.personal_id) } : {}),
    plan_block_id: v.folgeblock_id as number,
  };
}
