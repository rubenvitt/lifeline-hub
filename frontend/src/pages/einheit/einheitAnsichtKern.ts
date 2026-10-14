import type { Einheit, ModulFreigaben } from '../../api/types';
import { istSprungGesperrt } from '../../einsatz/modulRegistry';

/**
 * Reiner Kern der Einheit-Ansicht (LLH-1036, design.md D6 und D15): was die Bauteile unter
 * `pages/einheit/` ableiten, ohne React. Das Suffix `Kern` ist Pflicht (`frontend/AGENTS.md`,
 * „Direkteinstieg“).
 */

/**
 * Die Einheit selbst und alle ihre Nachfahren: wer darunter hängt, kann nicht ihre Über-Einheit
 * werden, sonst entstünde ein Kreis. Ein Kreis im Bestand bricht die Suche nicht.
 */
export function collectNachfahren(einheiten: readonly Einheit[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      if (!kinder.has(e.ueber_einheit_id)) kinder.set(e.ueber_einheit_id, []);
      kinder.get(e.ueber_einheit_id)!.push(e.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

/**
 * Was die Person in der Einheit-Ansicht bedienen darf, je Zielmodul (design.md D6, Entscheidung
 * 13.10.2026 Punkt 2). Ein Bauteil liest nur diese Tabelle, nie selbst die Freigaben: so steht
 * kein Bedienelement da, dessen Modul die Person nicht schreiben darf. Der Server prüft jeden Weg
 * selbst; die Tabelle vermeidet nur, was sicher scheitert.
 */
export interface EinheitRechte {
  /**
   * Schreiben + Einheiten: die Zeilen des Kopfs, Funk, Zeichen, Handstatus, „Als Einheitsführer“,
   * „Aus Einheit lösen“ und „Einheit auflösen“.
   */
  canEditEinheit: boolean;
  /** Schreiben + Einheiten + Personal: „Im Einsatz frei“ in „Person zuordnen …“. */
  canZuordnenPersonalEinsatz: boolean;
  /** Schreiben + Einheiten + Personal: „Aus dem Stamm“ in „Person zuordnen …“. */
  canZuordnenPersonalStamm: boolean;
  /** Schreiben + Einheiten + Fahrzeuge: „Im Einsatz frei“ in „Fahrzeug zuordnen …“. */
  canZuordnenFahrzeugEinsatz: boolean;
  /** Schreiben + Einheiten + Fahrzeuge: „Aus dem Stamm“ in „Fahrzeug zuordnen …“. */
  canZuordnenFahrzeugStamm: boolean;
  /** Schreiben + Fahrzeuge: „Auf <Funkrufname>“, „Vom Fahrzeug lösen“, FMS-Status. */
  canEditBesatzung: boolean;
  /** Schreiben + Einheiten + Material: „Material zuordnen …“. */
  canZuordnenMaterial: boolean;
  /** Freigabe Personal: der Name einer Person als Link. */
  hasPersonalLink: boolean;
  /** Freigabe Fahrzeuge: der Funkrufname eines Fahrzeugs als Link. */
  hasFahrzeugLink: boolean;
}

/**
 * Leitet die Tabelle aus dem Schreibrecht im Einsatz (`darfImEinsatzSchreiben`) und den
 * Modulfreigaben ab. Die Freigabe heißt im Client `zugriff` (Spec `modul-freigabe`) und kennt kein
 * eigenes Leserecht: „Lesen Personal“ und „Schreiben Personal“ fallen hier in dieselbe Freigabe,
 * das Schreiben selbst trägt `darfSchreiben`. Unbekannt heißt offen, wie `istSprungGesperrt`.
 */
export function buildEinheitRechte(
  darfSchreiben: boolean,
  freigaben: ModulFreigaben | undefined,
): EinheitRechte {
  const isOffen = (key: string) => !istSprungGesperrt(key, freigaben);
  const einheiten = darfSchreiben && isOffen('einheiten');
  const personal = isOffen('personal');
  const fahrzeuge = isOffen('fahrzeuge');
  return {
    canEditEinheit: einheiten,
    canZuordnenPersonalEinsatz: einheiten && personal,
    canZuordnenPersonalStamm: einheiten && personal,
    canZuordnenFahrzeugEinsatz: einheiten && fahrzeuge,
    canZuordnenFahrzeugStamm: einheiten && fahrzeuge,
    canEditBesatzung: darfSchreiben && fahrzeuge,
    canZuordnenMaterial: einheiten && isOffen('material'),
    hasPersonalLink: personal,
    hasFahrzeugLink: fahrzeuge,
  };
}
