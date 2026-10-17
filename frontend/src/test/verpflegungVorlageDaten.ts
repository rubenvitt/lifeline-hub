import type { VerpflegungVorlage } from '../api/types';

/** Testdaten des Verpflegungsplans (LLH-1058) — nur für Tests. */

/** Eine Mahlzeit; Vorgabe „Frühstück“ 06:30–08:00, aktiv, ohne Art. */
export function mahlzeit(over: Partial<VerpflegungVorlage> & { id: number }): VerpflegungVorlage {
  return {
    bezeichnung: 'Frühstück',
    beginn: '06:30',
    ende: '08:00',
    folgetag: false,
    aktiv: true,
    ...over,
  };
}

/** Der Plan aus der Spec: Frühstück, Mittag (warm), Abendessen und die Nachtverpflegung über
 *  Mitternacht. */
export function verpflegungsplan(): VerpflegungVorlage[] {
  return [
    mahlzeit({ id: 1 }),
    mahlzeit({
      id: 2,
      bezeichnung: 'Mittag',
      beginn: '12:00',
      ende: '13:30',
      verpflegungsart: 'warm',
    }),
    mahlzeit({ id: 3, bezeichnung: 'Abendessen', beginn: '18:00', ende: '19:30' }),
    mahlzeit({
      id: 4,
      bezeichnung: 'Nachtverpflegung',
      beginn: '23:00',
      ende: '01:00',
      folgetag: true,
      verpflegungsart: 'kalt',
    }),
  ];
}
