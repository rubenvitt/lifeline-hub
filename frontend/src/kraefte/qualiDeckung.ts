/**
 * Deckungsregel für Qualifikationen (LLH-1553, Spec `qualifikationen`, „Deckungsregel“).
 *
 * Eine Qualifikation schließt höchstens eine andere direkt ein (`schliesst_ein_id`), transitiv:
 * Notfallsanitäter → Rettungssanitäter → Sanitäter. Eine Person deckt eine geforderte
 * Qualifikation, wenn sie sie selbst hat oder eine, die sie einschließt.
 *
 * **Gleichlauf:** `src/personal/qualifikation_deckung.rs` rechnet dieselbe Regel. Beide Seiten
 * lesen die Fälle aus `tests/fixtures/quali_deckung_faelle.json`.
 */

/** Qualifikation → die direkt eingeschlossene. */
export type Einschluesse = ReadonlyMap<number, number | null>;

export interface Anforderung {
  qualifikation_id: number;
  anzahl: number;
}

export interface OffeneAnforderung {
  qualifikation_id: number;
  fehlen: number;
}

/** Baut die Einschlüsse aus Katalogeinträgen. */
export function einschluesseAus(
  katalog: readonly { id: number; schliesst_ein_id?: number | null }[],
): Einschluesse {
  return new Map(katalog.map((q) => [q.id, q.schliesst_ein_id ?? null]));
}

/**
 * Die Qualifikation selbst und alle, die sie transitiv einschließt. Ein Kreis (den der Server
 * ablehnt) bricht still ab.
 */
export function abschluss(katalog: Einschluesse, qualifikationId: number): number[] {
  const kette = [qualifikationId];
  const gesehen = new Set(kette);
  let naechste = katalog.get(qualifikationId);
  while (naechste != null && !gesehen.has(naechste)) {
    kette.push(naechste);
    gesehen.add(naechste);
    naechste = katalog.get(naechste);
  }
  return kette;
}

/** Ob eine Person mit diesen Qualifikationen die geforderte deckt. */
export function deckt(
  katalog: Einschluesse,
  person: readonly number[],
  gefordert: number,
): boolean {
  return person.some((q) => abschluss(katalog, q).includes(gefordert));
}

/**
 * Kandidaten für „Schließt ein“ an `qualifikationId`: alle anderen, deren eigene Kette nicht
 * zu ihr zurückführt (sonst entstünde ein Kreis).
 */
export function einschlussKandidaten<T extends { id: number }>(
  katalog: Einschluesse,
  eintraege: readonly T[],
  qualifikationId: number | null,
): T[] {
  if (qualifikationId == null) return [...eintraege];
  return eintraege.filter(
    (q) => q.id !== qualifikationId && !abschluss(katalog, q.id).includes(qualifikationId),
  );
}

/**
 * Welche Anforderungen die Personen offen lassen, in der Reihenfolge des Solls; ohne Lücke
 * leer. Jede geforderte Person ist ein Platz, eine Person deckt höchstens einen, die Zuteilung
 * ist maximal (Kuhn). Strengste Plätze zuerst, damit bei einer Lücke die niedrigere offen bleibt.
 */
export function offeneAnforderungen(
  katalog: Einschluesse,
  soll: readonly Anforderung[],
  personen: readonly (readonly number[])[],
): OffeneAnforderung[] {
  const strenge = (q: number) => abschluss(katalog, q).length - 1;
  const plaetze = soll
    .flatMap((a, i) =>
      Array.from({ length: Math.max(0, a.anzahl) }, () => ({ i, q: a.qualifikation_id })),
    )
    .map((p, reihe) => ({ ...p, reihe }))
    // Strengste zuerst, sonst die Reihenfolge des Solls (wie der stabile Sort in Rust).
    .sort((a, b) => strenge(b.q) - strenge(a.q) || a.reihe - b.reihe);
  const deckung = personen.map((p) => new Set(p.flatMap((q) => abschluss(katalog, q))));
  const personAuf: (number | null)[] = personen.map(() => null);

  const erweitere = (platz: number, besucht: boolean[]): boolean => {
    const gefordert = plaetze[platz].q;
    for (let person = 0; person < deckung.length; person++) {
      if (besucht[person] || !deckung[person].has(gefordert)) continue;
      besucht[person] = true;
      const anderer = personAuf[person];
      if (anderer === null || erweitere(anderer, besucht)) {
        personAuf[person] = platz;
        return true;
      }
    }
    return false;
  };

  const offenJe = soll.map(() => 0);
  plaetze.forEach((p, platz) => {
    if (
      !erweitere(
        platz,
        personen.map(() => false),
      )
    )
      offenJe[p.i] += 1;
  });
  return soll
    .map((a, i) => ({ qualifikation_id: a.qualifikation_id, fehlen: offenJe[i] }))
    .filter((o) => o.fehlen > 0);
}
