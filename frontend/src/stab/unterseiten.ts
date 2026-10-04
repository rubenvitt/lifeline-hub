import type { Sachgebiet } from '../api/types';
import {
  funkplanPfad,
  infotelefonPfad,
  kommunikationsplanPfad,
  pressePfad,
} from '../routing/deeplinks';

/**
 * Unterseiten des Stabs je Sachgebiet: Arbeitsergebnisse, die als eigene Adresse unter
 * `/einsaetze/:id/stab/…` liegen, aber kein Modul sind (LFH-548 Funkplan, LFH-848
 * Kommunikationsplan, LFH-554 Pressearbeit und Informationstelefon). Sperre und Sichtbarkeit
 * erben sie vom Stab; deshalb laufen sie NICHT durch `werkzeugeFuer` (das kennt nur
 * Registry-Module) und bleiben stehen, wenn die Modul-Werkzeuge einer Zeile ausgeblendet sind.
 *
 * Eine Tabelle statt eines Zweigs je Sachgebiet im Rendern: ein drittes Ziel ist ein Eintrag.
 */
export interface StabUnterseite {
  key: string;
  label: string;
  pfad: (einsatzId: number) => string;
}

const UNTERSEITEN: Partial<Record<Sachgebiet, readonly StabUnterseite[]>> = {
  s5: [
    { key: 'presse', label: 'Pressearbeit', pfad: (id) => pressePfad(id) },
    { key: 'infotelefon', label: 'Informationstelefon', pfad: (id) => infotelefonPfad(id) },
  ],
  s6: [
    { key: 'funkplan', label: 'Funkplan', pfad: (id) => funkplanPfad(id) },
    { key: 'kommunikationsplan', label: 'Kommunikationsplan', pfad: kommunikationsplanPfad },
  ],
};

export function unterseitenFuer(sachgebiet: Sachgebiet): readonly StabUnterseite[] {
  return UNTERSEITEN[sachgebiet] ?? [];
}
