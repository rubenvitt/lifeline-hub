import type { ZoneEntwurf } from './useKartenInteraktion';

/**
 * Zeichnen mit Bezirk (LLH-1069, Spec `betreuung-lagekarte`, „Bezirk und Fläche in beide Richtungen
 * verbunden“): `?zeichnen=evakuierungsbezirk&bezirk=<id>` aus dem Modul Evakuierung. Rein, damit
 * die Regeln ohne Karte prüfbar sind; der Effekt in `LagekartePage` liest die Parameter.
 */

/** Ein Bezirk, wie ihn die Karte aus `GET …/evakuierung` kennt (nur nicht stornierte). */
interface BekannterBezirk {
  id: number;
  bezeichnung: string;
}

/**
 * Steht fest, ob der Auftrag mit Bezug starten darf? Erst müssen die Modulfreigaben da sein, bei
 * freiem Modul Evakuierung auch die Bezirksliste — sonst verwürfe ein Kaltstart den Auftrag, bevor
 * der Bezirk bekannt ist. Ein gesperrtes Modul entscheidet ohne Liste.
 */
export function bezirkAuftragEntschieden(a: {
  rechteBekannt: boolean;
  evakuierungFrei: boolean;
  bezirkeGeladen: boolean;
}): boolean {
  if (!a.rechteBekannt) return false;
  return !a.evakuierungFrei || a.bezirkeGeladen;
}

/**
 * Der Entwurf mit Bezug, oder `null` (kein Modus, nur räumen): nur am Typ Evakuierungsbezirk, nur
 * mit Freigabe des Moduls Evakuierung und nur für einen Bezirk, den die Liste führt. Die Liste
 * kennt nur nicht stornierte Bezirke dieses Einsatzes; ein unbekannter, fremder oder stornierter
 * Bezirk startet also nichts (der Server lehnte ihn mit 404/409 ab).
 */
export function bezirkZeichnenEntwurf(
  entwurf: ZoneEntwurf,
  bezirkId: number,
  a: { evakuierungFrei: boolean; bezirke: readonly BekannterBezirk[] },
): ZoneEntwurf | null {
  if (entwurf.typ !== 'evakuierungsbezirk' || !a.evakuierungFrei) return null;
  const bezirk = a.bezirke.find((b) => b.id === bezirkId);
  return bezirk ? { ...entwurf, bezirk: { id: bezirk.id, bezeichnung: bezirk.bezeichnung } } : null;
}
