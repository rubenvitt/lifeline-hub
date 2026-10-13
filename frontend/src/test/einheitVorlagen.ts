import type { EinheitTyp, EinheitVorlage } from '../api/types';

/**
 * Feste Einheiten-Vorlagen für Komponententests (LLH-1042): ein Sanitätszug mit Rettungsstaffel
 * darunter (Demo), ein Löschzug ohne Fahrzeuge und eine deaktivierte SEG.
 */
export const EINHEIT_TYPEN: EinheitTyp[] = [
  { id: 1, label: 'Zug', sortier: 1, soll: { fuehrer: 1, unterfuehrer: 2, mannschaft: 19 } },
  { id: 2, label: 'Staffel', sortier: 2, soll: { fuehrer: 0, unterfuehrer: 1, mannschaft: 5 } },
];

export function einheitVorlageFixture(overrides: Partial<EinheitVorlage> = {}): EinheitVorlage {
  return {
    id: 1,
    name: 'Vorlage',
    typ_id: 1,
    typ_label: 'Zug',
    soll_eigen: false,
    sortier: 0,
    aktiv: true,
    ist_demo: false,
    fahrzeuge: [],
    personal: [],
    ...overrides,
  };
}

export const SANITAETSZUG = einheitVorlageFixture({
  id: 10,
  name: 'Sanitätszug Musterstadt',
  funkrufname: 'Rotkreuz Musterstadt 1',
  soll: { fuehrer: 1, unterfuehrer: 2, mannschaft: 19 },
  ist_demo: true,
  fahrzeuge: [
    {
      fahrzeug_id: 31,
      funkrufname: 'Rotkreuz Musterstadt 11-1',
      fahrzeugtyp: 'ELW 1',
      dienststatus: 'in_dienst',
      ist_demo: true,
      auch_in: [],
    },
  ],
  personal: [
    {
      personal_id: 41,
      name: 'Anna Zugführer',
      staerke_position: 'fuehrer',
      fahrzeug_id: 31,
      dienststatus: 'in_dienst',
      ist_demo: true,
      auch_in: [],
    },
  ],
});

export const RETTUNGSSTAFFEL = einheitVorlageFixture({
  id: 11,
  name: 'Rettungsstaffel',
  typ_id: 2,
  typ_label: 'Staffel',
  ueber_vorlage_id: 10,
  soll: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
  soll_eigen: true,
  ist_demo: true,
  fahrzeuge: [
    {
      fahrzeug_id: 32,
      funkrufname: 'Rotkreuz Musterstadt 83-1',
      fahrzeugtyp: 'RTW',
      dienststatus: 'ausser_dienst',
      ist_demo: true,
      auch_in: [12],
    },
  ],
  personal: [],
});

export const LOESCHZUG = einheitVorlageFixture({
  id: 12,
  name: 'Löschzug Nord',
  soll: { fuehrer: 1, unterfuehrer: 2, mannschaft: 19 },
  fahrzeuge: [
    {
      fahrzeug_id: 32,
      funkrufname: 'Rotkreuz Musterstadt 83-1',
      fahrzeugtyp: 'RTW',
      dienststatus: 'ausser_dienst',
      ist_demo: true,
      auch_in: [11],
    },
  ],
});

export const SEG = einheitVorlageFixture({
  id: 13,
  name: 'SEG Behandlung',
  aktiv: false,
});

/** In der Reihenfolge des Servers (Sortierung, Name): die Staffel steht NICHT unter dem Zug. */
export const VORLAGEN: EinheitVorlage[] = [LOESCHZUG, RETTUNGSSTAFFEL, SANITAETSZUG, SEG];
