/**
 * Was ein Tab über Benachrichtigungen weiß, modulweit statt je Zentrale: beim Wechsel zwischen
 * Org-Layout und Einsatz, zwischen zwei Einsätzen und bei einem Replay des Stroms bleibt so jede
 * Benachrichtigung eine. Ohne Abhängigkeiten, damit `test/setup.ts` es zurücksetzen kann, ohne
 * Module zu laden, die Tests mocken.
 */

/** Quittiert in diesem Tab (selbst oder über das Quittier-Ereignis): erscheint nicht wieder. */
export const quittiert = new Set<number>();
/** Text wird gerade geholt: ein zweites Ereignis derselben ID wartet nicht noch einmal. */
export const inArbeit = new Set<number>();
/** Schon einmal gezeigt: kommt sie nach einem Layoutwechsel wieder, dann ohne Ton. */
export const gezeigt = new Set<number>();

export function benachrichtigungenZuruecksetzenFuerTests(): void {
  quittiert.clear();
  inArbeit.clear();
  gezeigt.clear();
}
