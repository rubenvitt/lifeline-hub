import { createContext, useContext, type ReactNode } from 'react';
import {
  geraetAufnahmePfad,
  geraetPatientenPfad,
  geraetPersonPfad,
  geraetUhsPfad,
  personDetailPfad,
  personenAufnahmePfad,
  personenPfad,
  uhsDetailPfad,
} from './deeplinks';

/**
 * Wohin die Seiten führen, die Stabsoberfläche und Gerätehülle teilen (LFH-892, design.md D9):
 * Aufnahme, UHS mit Grundriss, Person. Unter `/einsaetze` die Modulpfade, in der Gerätehülle
 * deren Gegenstücke unter `/geraet`. Die Pfade selbst stehen in `deeplinks.ts`; hier wird nur
 * gewählt. Ohne Provider gilt die Stabsoberfläche.
 */
export interface EinsatzPfade {
  personDetail: (einsatzId: number, personId: number) => string;
  personenListe: (einsatzId: number) => string;
  uhsDetail: (einsatzId: number, uhsId: number) => string;
  aufnahme: (einsatzId: number, opts?: { uhs?: number }) => string;
}

export const STAB_PFADE: EinsatzPfade = {
  personDetail: personDetailPfad,
  personenListe: (einsatzId) => personenPfad(einsatzId),
  uhsDetail: uhsDetailPfad,
  aufnahme: personenAufnahmePfad,
};

export const GERAET_PFADE: EinsatzPfade = {
  personDetail: geraetPersonPfad,
  personenListe: geraetPatientenPfad,
  uhsDetail: geraetUhsPfad,
  aufnahme: geraetAufnahmePfad,
};

const PfadeKontext = createContext<EinsatzPfade>(STAB_PFADE);

export function EinsatzPfadeProvider({
  pfade,
  children,
}: {
  pfade: EinsatzPfade;
  children: ReactNode;
}) {
  return <PfadeKontext.Provider value={pfade}>{children}</PfadeKontext.Provider>;
}

export function useEinsatzPfade(): EinsatzPfade {
  return useContext(PfadeKontext);
}
