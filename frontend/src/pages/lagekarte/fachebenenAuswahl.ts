import type { FachebeneQuelle } from '../../api/fachebenen';

export type FachebenenSichtbar = Record<FachebeneQuelle, boolean>;

/** Default: alles aus. */
export function defaultFachebenenSichtbar(): FachebenenSichtbar {
  return {
    nina: false,
    dwd: false,
    pegelonline: false,
    hochwasser: false,
    luftqualitaet: false,
    odl: false,
    kritis: false,
    energie: false,
    autobahn: false,
    autobahn_parken: false,
    copernicus: false,
    copernicus_bilder: false,
    drohne: false,
  };
}
