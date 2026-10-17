/**
 * Besatzungswechsel (LLH-1150, Spec `kraefte-abloesung`, „Besatzungswechsel“): die Einheit und ihr
 * Fahrzeug bleiben, nur das Personal wechselt.
 *
 * Die bisherige Besatzung ist die Personalzuordnung der Einheit und jeder Untereinheit, die ihre
 * Schicht erbt; welche das sind, nennt der Server (`erbende_einheiten`), der Client rechnet keine
 * Vererbung nach (`frontend/src/kraefte/AGENTS.md`, „Ablösung“). Die neue Besatzung wählt die
 * Führung aus dem Personal des Einsatzes. Nicht wählbar ist, wer schon zur bisherigen gehört;
 * wer eine andere Einheit führt, steht gesperrt mit Grund in der Liste (der Server lehnt mit 422
 * ab). Nach dem Vollzug trägt die Schicht beide Besatzungen (`besatzung`).
 */
import type { Abloesung, BesatzungRolle, Einheit, EinsatzPersonal } from '../api/types';

/** Was die Besatzung von einer Einheit braucht (Ausschnitt aus `EinheitAnzeige`). */
export type BesatzungEinheit = Pick<Einheit, 'id' | 'name' | 'fuehrer_id' | 'personal_mitglieder'>;
/** Was die Auswahl von einer Person braucht (Ausschnitt aus `EinsatzPersonalAnzeige`). */
export type BesatzungPerson = Pick<EinsatzPersonal, 'id' | 'name' | 'einheit_id' | 'beendet_at'>;

export interface BesatzungOption {
  value: number;
  label: string;
  disabled?: boolean;
}

/** Die Einheiten, deren Personal beim Besatzungswechsel geht: die Einheit und ihre Erben. */
function besatzungEinheiten(schicht: Abloesung): number[] {
  // `?? []`: eine Schicht aus einem älteren Stand (Cache, Live) kann das Feld noch nicht tragen.
  return [schicht.einheit_id, ...(schicht.erbende_einheiten ?? []).map((e) => e.einheit_id)];
}

/**
 * Die bisherige Besatzung einer laufenden Schicht, wie die Einheitenliste sie führt: erst die
 * Einheit, dann ihre Erben in der Reihenfolge des Servers. `null`, solange die Einheiten fehlen.
 */
export function bisherigeBesatzung(
  schicht: Abloesung,
  einheiten: readonly BesatzungEinheit[] | undefined,
): string[] | null {
  if (!einheiten) return null;
  const jeEinheit = new Map(einheiten.map((e) => [e.id, e]));
  return besatzungEinheiten(schicht).flatMap((id) =>
    (jeEinheit.get(id)?.personal_mitglieder ?? []).map((m) => m.name),
  );
}

/**
 * Wählbare Personen der neuen Besatzung: jede aktive Person des Einsatzes außerhalb der
 * bisherigen Besatzung. Wer einer anderen Einheit angehört, nennt sie („· Florian 2“); wer eine
 * andere Einheit führt, ist gesperrt („· führt Florian 2“).
 */
export function besatzungOptionen(
  personal: readonly BesatzungPerson[],
  einheiten: readonly BesatzungEinheit[],
  schicht: Abloesung,
): BesatzungOption[] {
  const besatzung = new Set(besatzungEinheiten(schicht));
  const name = new Map(einheiten.map((e) => [e.id, e.name]));
  const fuehrt = new Map<number, string>();
  for (const e of einheiten) {
    if (e.fuehrer_id != null && !besatzung.has(e.id)) fuehrt.set(e.fuehrer_id, e.name);
  }
  return personal
    .filter((p) => p.beendet_at == null && !(p.einheit_id != null && besatzung.has(p.einheit_id)))
    .map((p) => {
      const gefuehrt = fuehrt.get(p.id);
      if (gefuehrt) return { value: p.id, label: `${p.name} · führt ${gefuehrt}`, disabled: true };
      const einheit = p.einheit_id != null ? name.get(p.einheit_id) : undefined;
      return { value: p.id, label: einheit ? `${p.name} · ${einheit}` : p.name };
    });
}

/** Die Namen einer Besatzung nach dem Vollzug, `null` ohne eine. */
export function besatzungText(schicht: Abloesung, rolle: BesatzungRolle): string | null {
  const namen = schicht.besatzung.filter((b) => b.rolle === rolle).map((b) => b.name);
  return namen.length > 0 ? namen.join(', ') : null;
}
