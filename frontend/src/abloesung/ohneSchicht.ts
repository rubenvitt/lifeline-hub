/**
 * Einheiten im Einsatz ohne Schicht (LLH-1128, Segment „Ohne Schicht“ der Seite Ablösung).
 *
 * Im Einsatz ist eine Einheit mit offener Einsatzperiode, wie der Server sie für das Ende mit der
 * Entlassung liest (`zeitachse::repo::has_offene_periode_tx`): die letzte Periode ohne Ende,
 * alarmiert oder eingetroffen. Ohne Schicht ist sie, wenn sie weder eine eigene laufende Schicht
 * hat noch eine erbt. Die Vererbung rechnet der Client nicht nach: sie steht in
 * `erbende_einheiten` der tragenden Schicht (`frontend/src/kraefte/AGENTS.md`, „Ablösung“).
 *
 * Gezählt werden nur Einheiten der Einheitenliste: eine aufgelöste fehlt dort, auch wenn ihre
 * Zeitachse eine offene Periode trägt.
 *
 * Ein geplanter Ablöser bleibt in der Menge, er hat ja keine Schicht; er nennt die Einheit, die
 * er ablösen soll. Seine Schicht entsteht mit dem Vollzug (Spec `kraefte-abloesung`, „Schicht
 * mit dem Eintreffen“), „Schicht beginnen“ bietet die Seite für ihn deshalb nicht an. Geplant ist
 * auch die Untereinheit eines geplanten Verbands (LLH-1311): er löst als Knoten ab, sie erbt die
 * Folgeschicht, und der Server lässt ihren Autostart aus (`abloesung::kopplung`,
 * `is_geplanter_abloeser_tx`). Wie dort zählt die eigene Planung zuerst, dann der nächste
 * geplante Vorfahr über `ueber_einheit_id` der Einheitenliste; ein Zyklus endet.
 *
 * Ordnung: wer am längsten im Einsatz ist, zuerst (Beginn der Periode, dann Kennung). Der Beginn
 * ist zugleich der Sortierschlüssel der Zuflussschleuse (`abloesung/zufluss.ts`).
 */
import type { Abloesung, EinheitPerioden } from '../api/types';
import { abloeserIds } from './abloeser';

/** Was die Menge von einer Einheit braucht (Ausschnitt aus `EinheitAnzeige`). */
export interface EinheitKurz {
  id: number;
  name: string;
  abschnitt_name?: string | null;
  ueber_einheit_id?: number | null;
}

export interface OhneSchicht {
  /** Die Kennung der Einheit — zugleich die Kennung in der Zuflussschleuse. */
  id: number;
  einheit_name: string;
  abschnitt_name: string | null;
  /** Beginn der offenen Periode (Alarmierung, ohne sie das Eintreffen), Wire-String. */
  beginn_at: string;
  eintreffen_at: string | null;
  /** Als ablösende Einheit geplant: der Name der Einheit, deren Schicht sie ablösen soll. */
  abloeser_fuer: string | null;
}

export function findOhneSchicht(
  einheiten: readonly EinheitKurz[],
  perioden: readonly EinheitPerioden[],
  laufende: readonly Abloesung[],
): OhneSchicht[] {
  const belegt = new Set<number>();
  const abloeserFuer = new Map<number, string>();
  for (const s of laufende) {
    if (s.status !== 'laufend') continue;
    belegt.add(s.einheit_id);
    for (const e of s.erbende_einheiten) belegt.add(e.einheit_id);
    // Jeder Eintrag der Liste (LLH-1132), ohne Liste der Spiegel.
    for (const id of abloeserIds(s)) abloeserFuer.set(id, s.einheit_name);
  }
  const offen = new Map<number, { beginn_at: string; eintreffen_at: string | null }>();
  for (const { einheit_id, perioden: p } of perioden) {
    const letzte = p[p.length - 1];
    if (letzte && !letzte.ende_at)
      offen.set(einheit_id, {
        beginn_at: letzte.beginn_at,
        eintreffen_at: letzte.eintreffen_at ?? null,
      });
  }
  const ueber = new Map(einheiten.map((e) => [e.id, e.ueber_einheit_id ?? null]));
  const ergebnis: OhneSchicht[] = [];
  for (const e of einheiten) {
    const periode = offen.get(e.id);
    if (!periode || belegt.has(e.id)) continue;
    ergebnis.push({
      id: e.id,
      einheit_name: e.name,
      abschnitt_name: e.abschnitt_name ?? null,
      ...periode,
      abloeser_fuer: geplantFuer(e.id, ueber, abloeserFuer),
    });
  }
  return ergebnis.sort((a, b) =>
    a.beginn_at < b.beginn_at ? -1 : a.beginn_at > b.beginn_at ? 1 : a.id - b.id,
  );
}

/**
 * Wofür die Einheit oder ihr nächster geplanter Vorfahr als Ablöser geplant ist; `null`, wenn
 * keiner in der Kette. Mit Besucht-Menge wie `is_geplanter_abloeser_tx` am Server.
 */
function geplantFuer(
  einheit: number,
  ueber: ReadonlyMap<number, number | null>,
  abloeserFuer: ReadonlyMap<number, string>,
): string | null {
  const besucht = new Set<number>();
  for (let k: number | null = einheit; k != null && !besucht.has(k); k = ueber.get(k) ?? null) {
    besucht.add(k);
    const fuer = abloeserFuer.get(k);
    if (fuer != null) return fuer;
  }
  return null;
}

/** Sortierschlüssel der Zuflussschleuse: der Beginn der offenen Periode. */
export const BEGINN_DER_PERIODE = (e: OhneSchicht): string => e.beginn_at;

/** Wortlaut des Sammelbanners über der Liste „Ohne Schicht“. */
export function ohneSchichtZuflussText(neu: number, umgeordnet: boolean): string {
  const teile: string[] = [];
  if (neu > 0)
    teile.push(neu === 1 ? '1 neue Einheit ohne Schicht' : `${neu} neue Einheiten ohne Schicht`);
  if (umgeordnet) teile.push('Reihenfolge geändert');
  return teile.join(' · ');
}
