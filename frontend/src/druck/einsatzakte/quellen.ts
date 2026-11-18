import type { ModulFreigaben } from '../../api/types';
import { BLOECKE, type BlockSchluessel } from '../einsatzbericht/auswahl';
import { freigabeDesModuls, modulLabel, type QuellenFreigabe } from '../einsatzbericht/quellen';

/**
 * Einsatzakte (LLH-1835, `openspec/changes/hsdhm2ki-einsatzakte/design.md` D3): woraus die Akte
 * schöpft und ob sie es abrufen darf. Vollständig oder gar nicht wie der Einsatzbericht: die
 * Weiche fällt VOR dem Abruf, ein gesperrtes Modul führt in die Sackgasse, ein im Einsatz
 * ausgeblendetes steht als „nicht genutzt“.
 */

/**
 * Die Module der Akte — Druck UND ZIP. Gespiegelt in `src/einsatzakte/mod.rs` (`AKTE_MODULE`);
 * der Rust-Test `akte_module_wie_im_client` vergleicht beide Listen samt Reihenfolge.
 */
export const AKTE_MODULE = [
  // Einsatzbericht in vollem Umfang (`../einsatzbericht/quellen.ts`).
  'lagebesprechung',
  'einheiten',
  'personal',
  'fahrzeuge',
  'lageberichte',
  'personen',
  'schaeden',
  'evakuierung',
  'betreuung',
  'verpflegung',
  'etb',
  'material',
  // Kapitel Aufträge und Einsatzbefehle.
  'auftraege',
  // Nur im ZIP: Anhänge und Tabellen.
  'dokumente',
  'tiere',
  'unfallhilfsstellen',
];

/** Der Einsatzbericht der Akte: alle Blöcke samt Anlagen. */
export const AKTE_BERICHT_BLOECKE: readonly BlockSchluessel[] = BLOECKE.map((b) => b.schluessel);

export type KapitelSchluessel =
  'bericht' | 'etb' | 'betroffene' | 'auftraege' | 'befehle' | 'lageberichte';

export interface KapitelDef {
  schluessel: KapitelSchluessel;
  titel: string;
  /** Modul-Key des Gates; `null` beim Bericht, der seine Quellen selbst weicht. */
  modul: string | null;
}

/** Die Kapitel in Druckreihenfolge (Spec `einsatzakte`, „Kapitel in fester Reihenfolge“). */
export const KAPITEL: readonly KapitelDef[] = [
  { schluessel: 'bericht', titel: 'Einsatzbericht', modul: null },
  { schluessel: 'etb', titel: 'Einsatztagebuch', modul: 'etb' },
  { schluessel: 'betroffene', titel: 'Betroffene', modul: 'personen' },
  { schluessel: 'auftraege', titel: 'Aufträge', modul: 'auftraege' },
  { schluessel: 'befehle', titel: 'Einsatzbefehle', modul: 'auftraege' },
  { schluessel: 'lageberichte', titel: 'Lageberichte', modul: 'lageberichte' },
];

export interface AkteFreigabe {
  /** Zustand je Kapitel; der Bericht ist `abrufen`, sobald die Akte nicht gesperrt ist. */
  kapitel: Record<KapitelSchluessel, Exclude<QuellenFreigabe, 'nicht-gewaehlt'>>;
  /** Anzeigenamen der gesperrten Module, in Reihenfolge von {@link AKTE_MODULE}. */
  gesperrteModule: string[];
}

export function akteFreigabe(freigaben: ModulFreigaben): AkteFreigabe {
  const gesperrteModule: string[] = [];
  for (const modul of AKTE_MODULE) {
    if (freigabeDesModuls(modul, freigaben) === 'gesperrt') {
      const label = modulLabel(modul);
      if (!gesperrteModule.includes(label)) gesperrteModule.push(label);
    }
  }
  const kapitel = {} as AkteFreigabe['kapitel'];
  for (const k of KAPITEL) {
    kapitel[k.schluessel] = k.modul == null ? 'abrufen' : freigabeDesModuls(k.modul, freigaben);
  }
  return { kapitel, gesperrteModule };
}
