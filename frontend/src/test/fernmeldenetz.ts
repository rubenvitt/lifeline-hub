import type {
  Fernmeldeskizze,
  KommunikationsStelleMitKanaelen,
  SkizzenVerbindung,
  Verbindungsstatus,
} from '../api/fernmeldeskizzeVertrag';
import type {
  Einheit,
  Einsatzabschnitt,
  Fuehrungsstelle,
  KommunikationsStelle,
  Sprechgruppe,
} from '../api/types';
import type { FernmeldenetzQuellen } from '../stab/fernmeldeskizze';
import type { Quelle } from '../stab/luecken';

/**
 * Datenfabriken für Tests der Fernmeldeskizze (LFH-893): Quellen für `baueFernmeldenetz` mit
 * neutralen Vorgaben. Was ein Test prüft, gehört als Override an den Aufruf.
 */

export function sg(
  id: number,
  betriebsart: 'TMO' | 'DMO',
  bezeichnung: string,
  lokal = false,
): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: lokal, sortier: id };
}

export function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `Abschnitt ${id}`, sortier: id, sprechgruppen: [], ...p };
}

export function einheit(id: number, p: Partial<Einheit> = {}): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `Einheit ${id}`,
    sortier: id,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
    ...p,
  } as Einheit;
}

export function stelle(
  id: number,
  stellenart: KommunikationsStelle['stellenart'],
  p: {
    bezeichnung?: string;
    kanaele?: [Sprechgruppe, Verbindungsstatus][];
    rufnummer?: string;
  } = {},
): KommunikationsStelleMitKanaelen {
  return {
    id,
    stellenart,
    bezeichnung: p.bezeichnung ?? `Stelle ${id}`,
    verbindungen: p.rufnummer ? [{ id: id * 10, mittel: 'festnetz', wert: p.rufnummer }] : [],
    sprechgruppen: (p.kanaele ?? []).map(([sprechgruppe, status]) => ({ sprechgruppe, status })),
  };
}

export function verbindung(
  id: number,
  von: SkizzenVerbindung['von'],
  nach: SkizzenVerbindung['nach'],
  p: Partial<SkizzenVerbindung> = {},
): SkizzenVerbindung {
  return {
    id,
    von,
    nach,
    art: 'daten',
    medium: 'leitung',
    status: 'bestehend',
    verkehr: null,
    hinweis: null,
    ...p,
  };
}

export const LEER_SKIZZE: Fernmeldeskizze = {
  lage: [],
  komponenten: [],
  verbindungen: [],
  bereiche: [],
  schriftfeld: {
    herausgeber: null,
    vs_vermerk: 'keiner',
    gueltig_ab: null,
    gez_name: null,
    gez_at: null,
  },
  stand: null,
};

export const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });

export const fs = (p: Partial<Fuehrungsstelle> = {}): FernmeldenetzQuellen['fuehrungsstelle'] => ({
  zustand: 'daten',
  daten: { sprechgruppen: [], ...p },
});

/** Quellen mit leeren, geladenen Listen; `skizze` wird in die leere Skizze gemischt. */
export function quellen(
  p: Partial<Omit<FernmeldenetzQuellen, 'skizze'>> & { skizze?: Partial<Fernmeldeskizze> } = {},
): FernmeldenetzQuellen {
  const { skizze, ...rest } = p;
  return {
    einsatzId: 7,
    abschnitte: daten([]),
    einheiten: daten([]),
    fuehrungsstelle: { zustand: 'daten', daten: null },
    sprechgruppen: daten([]),
    stellen: daten([]),
    skizze: { zustand: 'daten', daten: { ...LEER_SKIZZE, ...skizze } },
    ...rest,
  };
}
