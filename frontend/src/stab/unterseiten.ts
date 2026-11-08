import type { Sachgebiet } from '../api/types';
import { funkplanPfad, kommunikationsplanPfad, pressePfad } from '../routing/deeplinks';

/**
 * Arbeitsseiten je Sachgebiet, die die Stab-Seite als Einstieg führt: S5 Pressearbeit (LFH-554)
 * als Unterseite des Stabs unter `/einsaetze/:id/stab/…`, kein Modul, Sperre und Sichtbarkeit vom
 * Stab (das Informationstelefon ist seit i6k6mzed ein eigenes Modul und steht in
 * `fuehrung/sachgebiete.ts` als Modul-Werkzeug); S6 Funkplan, Fernmeldeskizze, Sprechgruppen und
 * Kommunikationsplan (LFH-548, LFH-893, LFH-848) als Sprung in das eigene Modul Fernmeldewesen
 * (LLH-1180), mit dessen Sperre. Skizze und Sprechgruppen sind Darstellungen des Funkplans
 * (`?ansicht=`). Die Kacheln der Stab-Seite reihen sie über `fuehrung/sachgebiete.ts` ein.
 *
 * Eine Tabelle statt eines Zweigs je Sachgebiet im Rendern: ein drittes Ziel ist ein Eintrag.
 */
export interface StabUnterseite {
  key: string;
  label: string;
  /** Modul, dessen Freigabe die Seite trägt: der Stab selbst oder das Fernmeldewesen. */
  modul: 'stab' | 'fernmeldewesen';
  pfad: (einsatzId: number) => string;
}

const UNTERSEITEN: Partial<Record<Sachgebiet, readonly StabUnterseite[]>> = {
  s5: [{ key: 'presse', label: 'Pressearbeit', modul: 'stab', pfad: (id) => pressePfad(id) }],
  s6: [
    { key: 'funkplan', label: 'Funkplan', modul: 'fernmeldewesen', pfad: (id) => funkplanPfad(id) },
    {
      key: 'fernmeldeskizze',
      label: 'Fernmeldeskizze',
      modul: 'fernmeldewesen',
      pfad: (id) => funkplanPfad(id, { ansicht: 'skizze' }),
    },
    {
      key: 'sprechgruppen',
      label: 'Sprechgruppen',
      modul: 'fernmeldewesen',
      pfad: (id) => funkplanPfad(id, { ansicht: 'sprechgruppen' }),
    },
    {
      key: 'kommunikationsplan',
      label: 'Kommunikationsplan',
      modul: 'fernmeldewesen',
      pfad: kommunikationsplanPfad,
    },
  ],
};

export function unterseitenFuer(sachgebiet: Sachgebiet): readonly StabUnterseite[] {
  return UNTERSEITEN[sachgebiet] ?? [];
}
