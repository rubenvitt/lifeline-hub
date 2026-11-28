import type { KanalArt, KanalMitStelle } from '../api/types';

/** Rang der Vorbelegung je Kanal (kleiner gewinnt); Fax wird vorher ausgelassen. */
const RANG: Record<KanalArt, number> = { matrix: 0, threema: 1, email: 2, fax: 3 };

/** Vergleichsform eines Namens: ohne Groß/Klein, Leerraum zusammengezogen. */
function norm(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Vorbelegung des Senden-Dialogs (LLH-2093, LLH-2094, Spec 8): je Stelle, deren Bezeichnung einem
 * Namen aus dem Verteiler bzw. dem Adressaten gleicht, genau eine Adresse: die erste
 * Matrix-Adresse, sonst die erste Threema-ID (LLH-2096), sonst die erste Mailadresse; eine
 * Faxnummer nie (LLH-2095). Ganze Namen, kein
 * Teilvergleich: „Nord“ trifft nicht „Leitstelle Nord“. Ein Bericht soll bei derselben Stelle
 * nicht doppelt landen. Liefert die `id`s der Adressen.
 */
export function empfaengerVorschlag(
  kanaele: readonly KanalMitStelle[],
  namen: readonly string[],
): Set<number> {
  const gesucht = new Set(namen.map(norm).filter((n) => n !== ''));
  const jeStelle = new Map<number, KanalMitStelle>();
  for (const k of kanaele) {
    if (k.channel.channel === 'fax' || !gesucht.has(norm(k.agency_name))) continue;
    const bisher = jeStelle.get(k.agency_id);
    // Ein höherer Rang verdrängt; bei gleichem bleibt die erste.
    if (!bisher || RANG[k.channel.channel] < RANG[bisher.channel.channel]) {
      jeStelle.set(k.agency_id, k);
    }
  }
  return new Set([...jeStelle.values()].map((k) => k.channel.id));
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
