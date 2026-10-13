import type { ModulFreigaben, Sachgebiet } from '../api/types';
import {
  istSprungGesperrt,
  modulRegistry,
  modulZielRoute,
  type ModulEintrag,
} from '../einsatz/modulRegistry';
import { einsatzModulPfad } from '../routing/deeplinks';
import type { WerkzeugEintrag } from './sachgebiete';
import { unterseitenFuer } from './unterseiten';

/** Ein Werkzeug, das in der Kachel steht: frei als Sprung oder gesperrt mit Grund. */
export interface SichtbaresWerkzeug {
  zustand: 'frei' | 'gesperrt';
  key: string;
  label: string;
  /** Modul, dessen Freigabe das Werkzeug trägt (bei einer Unterseite `stab` oder `fernmeldewesen`). */
  modulKey: string;
  pfad: (einsatzId: number) => string;
}

export type WerkzeugState = SichtbaresWerkzeug | { zustand: 'fehlt' };

const FEHLT = { zustand: 'fehlt' } as const;

/**
 * Was aus einem Werkzeug einer Kachel wird — EINE Regel für Module und Unterseiten
 * (`openspec/changes/o5nxgqbl-stab-uebersicht/design.md`, D2): ausgeblendet, unbekannt oder unfertig
 * fehlt es; gesperrt (`istSprungGesperrt`) steht es mit Grund da, ohne Sprung und ohne Zahl; sonst
 * springt es. Solange die Freigaben des Servers fehlen, fehlt jedes Werkzeug (unbekannt heißt nicht
 * frei). Früher verschwand ein gesperrtes Modul still, während die Unterseiten gesperrt standen.
 */
export function werkzeugState(
  sachgebiet: Sachgebiet,
  eintrag: WerkzeugEintrag,
  freigaben: ModulFreigaben | undefined,
  register: ModulEintrag[] = modulRegistry,
): WerkzeugState {
  if (!freigaben) return FEHLT;
  if (eintrag.art === 'modul') {
    const modul = register.find((m) => m.key === eintrag.key);
    if (!modul || modul.status !== 'fertig') return FEHLT;
    return sichtbar(eintrag.key, modul.label, modul.key, freigaben, (id) =>
      einsatzModulPfad(id, modulZielRoute(modul)),
    );
  }
  const unterseite = unterseitenFuer(sachgebiet).find((u) => u.key === eintrag.key);
  if (!unterseite) return FEHLT;
  return sichtbar(unterseite.key, unterseite.label, unterseite.modul, freigaben, unterseite.pfad);
}

function sichtbar(
  key: string,
  label: string,
  modulKey: string,
  freigaben: ModulFreigaben,
  pfad: (einsatzId: number) => string,
): WerkzeugState {
  const freigabe = freigaben[modulKey];
  if (!freigabe || !freigabe.sichtbar) return FEHLT;
  return {
    zustand: istSprungGesperrt(modulKey, freigaben) ? 'gesperrt' : 'frei',
    key,
    label,
    modulKey,
    pfad,
  };
}
