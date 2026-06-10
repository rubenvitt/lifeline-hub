import type { FachebeneQuelle } from '../../api/fachebenen';

export type FachebenenSichtbar = Record<FachebeneQuelle, boolean>;

const schluessel = (einsatzId: number) => `fachebenen:sichtbar:${einsatzId}`;

export function merkeFachebenenSichtbar(einsatzId: number, wahl: FachebenenSichtbar): void {
  try {
    localStorage.setItem(schluessel(einsatzId), JSON.stringify(wahl));
  } catch {
    /* localStorage nicht verfügbar — ohne Persistenz weiterarbeiten */
  }
}

export function liesFachebenenSichtbar(einsatzId: number): FachebenenSichtbar | null {
  try {
    const roh = localStorage.getItem(schluessel(einsatzId));
    if (!roh) return null;
    const w = JSON.parse(roh) as Partial<FachebenenSichtbar>;
    return {
      nina: w.nina === true,
      dwd: w.dwd === true,
      pegelonline: w.pegelonline === true,
      kritis: w.kritis === true,
    };
  } catch {
    return null;
  }
}

/** Default: alles aus. */
export function defaultFachebenenSichtbar(): FachebenenSichtbar {
  return { nina: false, dwd: false, pegelonline: false, kritis: false };
}
