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
 *
 * Verteilung und Planung (LLH-1319): je neuer Person optional eine Ziel-Einheit (die Einheit oder
 * ein Erbe) und ein Fahrzeug dieser Einheiten; nur gültige Ziele stehen zur Wahl. Ein geplanter
 * Besatzungswechsel (`besatzung_plan`) belegt den Vollzug vor, die Folgeschicht trägt die neue
 * Besatzung (`nach_besatzungswechsel`).
 */
import type {
  Abloesung,
  AbloesungBesatzungPlan,
  BesatzungRolle,
  BesatzungZielEingabe,
  Einheit,
  EinsatzPersonal,
} from '../api/types';

/** Was die Besatzung von einer Einheit braucht (Ausschnitt aus `EinheitAnzeige`). */
export type BesatzungEinheit = Pick<Einheit, 'id' | 'name' | 'fuehrer_id' | 'personal_mitglieder'>;
/** Was die Auswahl von einer Person braucht (Ausschnitt aus `EinsatzPersonalAnzeige`). */
export type BesatzungPerson = Pick<EinsatzPersonal, 'id' | 'name' | 'einheit_id' | 'beendet_at'>;

export interface BesatzungOption {
  value: number;
  label: string;
  /** Der Name allein, für die Zeilen der Verteilung (LLH-1319). */
  name: string;
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
      if (gefuehrt) {
        return {
          value: p.id,
          label: `${p.name} · führt ${gefuehrt}`,
          name: p.name,
          disabled: true,
        };
      }
      const einheit = p.einheit_id != null ? name.get(p.einheit_id) : undefined;
      return { value: p.id, label: einheit ? `${p.name} · ${einheit}` : p.name, name: p.name };
    });
}

/** Die Namen einer Besatzung nach dem Vollzug, `null` ohne eine. */
export function besatzungText(schicht: Abloesung, rolle: BesatzungRolle): string | null {
  const namen = schicht.besatzung.filter((b) => b.rolle === rolle).map((b) => b.name);
  return namen.length > 0 ? namen.join(', ') : null;
}

// ── Verteilung und Planung (LLH-1319) ────────────────────────────────────────

/** Was die Verteilung von einer Einheit braucht (Ausschnitt aus `EinheitAnzeige`). */
export type VerteilungEinheit = Pick<Einheit, 'id' | 'name' | 'fahrzeug_mitglieder'>;

/** Ein Ziel der Verteilung: Einheit oder Fahrzeug (`einsatz_fahrzeug.id`). */
export interface ZielOption {
  value: number;
  label: string;
}

/** Die Ziele, unter denen der Dialog verteilt: Einheit samt Erben, deren aktive Fahrzeuge. */
export interface VerteilungZiele {
  einheiten: ZielOption[];
  fahrzeuge: ZielOption[];
}

/** Ziel einer Person im Formular; fehlt eine Angabe, gilt die Vorgabe des Servers. */
export interface VerteilungWert {
  einheit_id?: number;
  fahrzeug_id?: number;
}

/** Je Person (als Text, `Form` legt Zahlenschlüssel als Feld an) ihr Ziel. */
export type Verteilung = Record<string, VerteilungWert | undefined>;

/**
 * Die Ziele der Verteilung (Spec `kraefte-abloesung`, „Besatzungswechsel verteilen“): die Einheit
 * der Schicht, dann ihre Erben in der Reihenfolge des Servers; die Fahrzeuge dieser Einheiten
 * (die Einheitenliste führt nur aktive). `null`, wenn es nichts zu wählen gibt (keine Erben,
 * keine Fahrzeuge) oder die Einheiten fehlen — dann fehlt das Klappteil.
 */
export function verteilungZiele(
  schicht: Abloesung,
  einheiten: readonly VerteilungEinheit[] | undefined,
): VerteilungZiele | null {
  if (!einheiten) return null;
  const jeEinheit = new Map(einheiten.map((e) => [e.id, e]));
  const ids = besatzungEinheiten(schicht);
  const fahrzeuge = ids.flatMap((id) =>
    (jeEinheit.get(id)?.fahrzeug_mitglieder ?? []).map((f) => ({
      value: f.ef_id,
      label: f.funkrufname,
    })),
  );
  if (ids.length < 2 && fahrzeuge.length === 0) return null;
  const name = (id: number) =>
    jeEinheit.get(id)?.name ??
    (id === schicht.einheit_id
      ? schicht.einheit_name
      : schicht.erbende_einheiten.find((e) => e.einheit_id === id)?.einheit_name) ??
    '';
  return { einheiten: ids.map((id) => ({ value: id, label: name(id) })), fahrzeuge };
}

/**
 * Vorbelegung des Vollzugs aus dem geplanten Besatzungswechsel (design.md D6): die Personen, die
 * noch wählbar sind, mit ihrer Verteilung; ein Ziel, das es nicht mehr gibt, fällt auf die
 * Vorgabe zurück (Einheit der Schicht, Fahrzeug unverändert).
 */
export function planVorbelegung(
  schicht: Abloesung,
  personen: readonly BesatzungOption[],
  ziele: VerteilungZiele | null,
): { ids: number[]; verteilung: Verteilung } {
  const waehlbar = new Set(personen.filter((p) => !p.disabled).map((p) => p.value));
  const einheiten = new Set(ziele?.einheiten.map((o) => o.value) ?? []);
  const fahrzeuge = new Set(ziele?.fahrzeuge.map((o) => o.value) ?? []);
  const ids: number[] = [];
  const verteilung: Verteilung = {};
  for (const p of schicht.besatzung_plan ?? []) {
    if (!waehlbar.has(p.personal_id)) continue;
    ids.push(p.personal_id);
    const wert: VerteilungWert = {};
    if (p.einheit_id != null && einheiten.has(p.einheit_id)) wert.einheit_id = p.einheit_id;
    if (p.fahrzeug_id != null && fahrzeuge.has(p.fahrzeug_id)) wert.fahrzeug_id = p.fahrzeug_id;
    verteilung[String(p.personal_id)] = wert;
  }
  return { ids, verteilung };
}

/** Weicht das Ziel einer Person von der Vorgabe ab (andere Einheit oder ein Fahrzeug)? */
function verteilt(wert: VerteilungWert | undefined, schicht: Abloesung): boolean {
  return (
    (wert?.einheit_id != null && wert.einheit_id !== schicht.einheit_id) ||
    wert?.fahrzeug_id != null
  );
}

/**
 * Kopf des Klappteils „Verteilen“: er nennt die Abweichung von der Vorgabe („alle in Florian 1“
 * bzw. „2 verteilt“, `frontend/AGENTS.md`, „Ein Pflichtfeld gehört nie hinter den Collapse“).
 */
export function verteilungKopf(
  ids: readonly number[],
  verteilung: Verteilung | undefined,
  schicht: Abloesung,
): string {
  const n = ids.filter((id) => verteilt(verteilung?.[String(id)], schicht)).length;
  return n === 0 ? `Verteilen · alle in ${schicht.einheit_name}` : `Verteilen · ${n} verteilt`;
}

/**
 * Die Personen mit ihrem Ziel für den Server (`besatzung` im Vollzug, `besatzung_plan` beim
 * Planen); die Einheit der Schicht ist die Vorgabe und geht ohne Angabe.
 */
export function besatzungZiele(
  ids: readonly number[],
  verteilung: Verteilung | undefined,
  schicht: Abloesung,
): BesatzungZielEingabe[] {
  return ids.map((id) => {
    const wert = verteilung?.[String(id)];
    const ziel: BesatzungZielEingabe = { personal_id: id };
    if (wert?.einheit_id != null && wert.einheit_id !== schicht.einheit_id) {
      ziel.einheit_id = wert.einheit_id;
    }
    if (wert?.fahrzeug_id != null) ziel.fahrzeug_id = wert.fahrzeug_id;
    return ziel;
  });
}

/** Eine Person des Plans mit ihrer Verteilung, wo sie abweicht: „Cora Neu (Gruppe 1, Florian 1-44)“. */
function planPerson(p: AbloesungBesatzungPlan): string {
  const ziel = [p.einheit_name, p.funkrufname].filter((t): t is string => !!t);
  return ziel.length > 0 ? `${p.name} (${ziel.join(', ')})` : p.name;
}

/**
 * Der geplante Besatzungswechsel einer laufenden Schicht: `kurz` für die Karte („Cora Neu, Dirk
 * Neu“), `voll` samt Verteilung für den Titel. `null` ohne Planung.
 */
export function besatzungPlanText(schicht: Abloesung): { kurz: string; voll: string } | null {
  const plan = schicht.besatzung_plan ?? [];
  if (plan.length === 0) return null;
  return {
    kurz: plan.map((p) => p.name).join(', '),
    voll: plan.map(planPerson).join(', '),
  };
}

/** Die Besatzung, mit der eine Schicht nach einem Besatzungswechsel begann; `null` sonst. */
export function nachBesatzungswechselText(schicht: Abloesung): string | null {
  const namen = (schicht.nach_besatzungswechsel ?? []).map((b) => b.name);
  return namen.length > 0 ? namen.join(', ') : null;
}
