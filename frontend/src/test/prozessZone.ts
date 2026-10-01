import { afterEach, beforeEach } from 'vitest';

/**
 * Stellt die Prozesszone (= „Browserzone“ im Test) für den umgebenden `describe` um.
 *
 * Die Suite läuft unter `TZ=Europe/Berlin` (`scripts/check-all.sh`). Ein Zonentest mit
 * Anzeigezone Berlin wäre damit blind grün: Browser- und Anzeigezone fielen zusammen. Node
 * übernimmt `process.env.TZ` zur Laufzeit, deshalb lässt sich die Zone je Block umstellen
 * (`openspec/changes/lfh-692-zeiteingabe-anzeigezone/design.md`, D8).
 */
export function mitProzessZone(zone: string): void {
  const vorher = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (vorher === undefined) delete process.env.TZ;
    else process.env.TZ = vorher;
  });
}
