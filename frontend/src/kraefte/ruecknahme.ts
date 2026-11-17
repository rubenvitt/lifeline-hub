import type { RuecknahmeAusgelassen } from '../api/types';

/**
 * Der Satz zu einer Rücknahme, die nicht alles zurückbekam (LLH-1722 Fahrzeug, LLH-1923
 * Material): „83-1 zurück, ohne: Anna Müller (inzwischen auf einem anderen Fahrzeug)“. Steht im
 * Seitenhinweis, denn einen Teilerfolg überliest im Toast jeder.
 */
export function ausgelassenSatz(name: string, ausgelassen: RuecknahmeAusgelassen[]): string {
  const teile = ausgelassen.map((a) => `${a.bezeichnung} (${a.grund})`);
  return `${name} zurück, ohne: ${teile.join(', ')}`;
}
