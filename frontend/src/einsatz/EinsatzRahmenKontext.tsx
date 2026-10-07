import { createContext, useContext } from 'react';
import type { EinsatzAnzeige } from '../api/types';

/**
 * Der geladene Einsatz des Rahmens (LFH-954, design.md D3): `EinsatzSeite` liest daraus den
 * Einsatzstatus für den Seitenkopf, statt dass jede Seite ihn selbst in ihr h1 hängt. `undefined`
 * außerhalb des Einsatzrahmens (Gerätehülle, Einzeltests) und solange der Einsatz lädt.
 */
const EinsatzRahmenKontext = createContext<EinsatzAnzeige | undefined>(undefined);

export const EinsatzRahmenProvider = EinsatzRahmenKontext.Provider;

export function useEinsatzRahmen(): EinsatzAnzeige | undefined {
  return useContext(EinsatzRahmenKontext);
}
