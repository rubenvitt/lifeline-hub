import type { RuecknahmeAusgelassen } from '../api/types';

/**
 * Der Satz zu einer Rücknahme, die nicht alles zurückbekam (LLH-1722 Fahrzeug, LLH-1922 Person):
 * „83-1 zurück, ohne: Anna Müller (inzwischen auf einem anderen Fahrzeug)“.
 */
export function ausgelassenSatz(
  name: string,
  antwort: { ausgelassen: RuecknahmeAusgelassen[] },
): string {
  const teile = antwort.ausgelassen.map((a) => `${a.bezeichnung} (${a.grund})`);
  return `${name} zurück, ohne: ${teile.join(', ')}`;
}
