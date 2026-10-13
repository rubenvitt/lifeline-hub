import type { Sachgebiet } from '../api/types';
import {
  funkplanPfad,
  infotelefonPfad,
  kommunikationsplanPfad,
  pressePfad,
} from '../routing/deeplinks';

/**
 * Arbeitsseiten je Sachgebiet, die die Stab-Seite als Einstieg führt: S5 Pressearbeit und
 * Informationstelefon (LFH-554) als Unterseiten des Stabs unter `/einsaetze/:id/stab/…`, kein
 * Modul, Sperre und Sichtbarkeit vom Stab; S6 Funkplan, Fernmeldeskizze, Sprechgruppen und
 * Kommunikationsplan (LFH-548, LFH-893, LFH-848) als Sprung in das eigene Modul Fernmeldewesen
 * (LLH-1180), mit dessen Sperre. Skizze und Sprechgruppen sind Darstellungen des Funkplans
 * (`?ansicht=`). Die Kacheln der Stab-Seite reihen sie über `stab/sachgebiete.ts` ein.
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
  s5: [
    { key: 'presse', label: 'Pressearbeit', modul: 'stab', pfad: (id) => pressePfad(id) },
    {
      key: 'infotelefon',
      label: 'Informationstelefon',
      modul: 'stab',
      pfad: (id) => infotelefonPfad(id),
    },
  ],
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
