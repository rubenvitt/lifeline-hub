/**
 * Der reine Teil des hängenden Gerüsts (`HaengenderBaum.tsx`): Knotenform und Klappschlüssel.
 * Ohne React, damit Modelle (`fuehrungsorganisation.ts`, `stab/fernmeldeskizze.ts`) ihn nutzen
 * können, ohne die Darstellung zu laden.
 */
export interface BaumKnoten<K> {
  key: string;
  kinder: readonly K[];
}

/** Schlüssel aller Knoten mit Kindern — „Alle zuklappen“ und der Druck klappen hierüber. */
export function klappbareSchluessel<K extends BaumKnoten<K>>(knoten: readonly K[]): string[] {
  return knoten.flatMap((k) =>
    k.kinder.length > 0 ? [k.key, ...klappbareSchluessel(k.kinder)] : [],
  );
}
