import type { KanalMitStelle } from '../api/types';

/** Vergleichsform eines Namens: ohne Groß/Klein, Leerraum zusammengezogen. */
function norm(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Vorbelegung des Senden-Dialogs (LLH-2093, Spec 7): die Kanaladressen der Stellen, deren
 * Bezeichnung einem Namen aus dem Verteiler bzw. dem Adressaten gleicht. Ganze Namen, kein
 * Teilvergleich: „Nord“ trifft nicht „Leitstelle Nord“. Liefert die `id`s der Adressen.
 */
export function empfaengerVorschlag(
  kanaele: readonly KanalMitStelle[],
  namen: readonly string[],
): Set<number> {
  const gesucht = new Set(namen.map(norm).filter((n) => n !== ''));
  return new Set(kanaele.filter((k) => gesucht.has(norm(k.agency_name))).map((k) => k.channel.id));
}

/** Namen der externen Einträge eines Verteilers (`extern_bezeichnung`), für die Vorbelegung. */
export function externeVerteilerNamen(
  verteiler: readonly { empfaenger_typ: string; extern_bezeichnung?: string | null }[] | undefined,
): string[] {
  return (verteiler ?? [])
    .filter((e) => e.empfaenger_typ === 'extern' && e.extern_bezeichnung)
    .map((e) => e.extern_bezeichnung as string);
}

/** Der Beginn des freigegebenen Textes für die Vorschau: Abschnittstexte hintereinander. */
export function abschnittVorschau(abschnitte: readonly { text: string }[]): string {
  return abschnitte
    .map((a) => a.text)
    .filter((t) => t.trim() !== '')
    .join('\n');
}
