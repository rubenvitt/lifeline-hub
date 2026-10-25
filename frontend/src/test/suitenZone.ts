/**
 * Zeitzone der Vitest-Suite (LLH-1433): Europe/Berlin, die Zielumgebung. Viele Erwartungen sind
 * Berliner Wanduhr aus UTC-Wire-Strings; ohne feste Zone hinge das Ergebnis an der Zone des
 * Rechners (Container und CI-Runner laufen in UTC). Ein `TZ` der Shell wirkt deshalb nicht,
 * `TZ_ERZWUNGEN` lässt die Suite bewusst in einer anderen Zone laufen (wie `scripts/check-all.sh`).
 *
 * Als `globalSetup` läuft das im Hauptprozess, bevor ein Worker startet: ein Fork erbt die
 * Umgebung, ein Thread teilt die Zone des Prozesses. `test.env` reichte nicht — dort setzt Vitest
 * `TZ` erst im Worker, und in einem Thread übernimmt Node die Zone dann nicht (gemessen,
 * `--pool=threads`). Ein Block, der die Zone wechselt, nimmt `mitProzessZone` (`./prozessZone.ts`).
 */
export default function setup(): void {
  process.env.TZ = process.env.TZ_ERZWUNGEN || 'Europe/Berlin';
}
