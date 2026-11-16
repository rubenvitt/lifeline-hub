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

/**
 * Ob eine Seite im Einsatzrahmen steht (LLH-1728, design.md D6), auch solange der Einsatz noch
 * lädt: dann ist {@link useEinsatzRahmen} noch `undefined`. `EinsatzSeite` zeigt im Rahmen unter
 * `md` statt des Ortspfads nur den Rückweg, denn den Einsatz nennt dort der Kopf.
 */
const ImEinsatzRahmenKontext = createContext(false);

export const ImEinsatzRahmenProvider = ImEinsatzRahmenKontext.Provider;

export function useImEinsatzRahmen(): boolean {
  return useContext(ImEinsatzRahmenKontext);
}
