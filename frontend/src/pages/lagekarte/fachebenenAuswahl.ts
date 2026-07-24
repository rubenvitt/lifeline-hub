import type { FachebeneQuelle } from '../../api/fachebenen';

export type FachebenenSichtbar = Record<FachebeneQuelle, boolean>;

/** Default: alles aus. */
export function defaultFachebenenSichtbar(): FachebenenSichtbar {
  return { nina: false, dwd: false, pegelonline: false, kritis: false };
}
