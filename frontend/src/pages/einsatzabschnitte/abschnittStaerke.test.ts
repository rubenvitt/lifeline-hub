import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt } from '../../api/types';
import { abschnittStaerken, nachfahrenInkl } from './abschnittStaerke';

function abschnitt(id: number, ueber: number | null): Einsatzabschnitt {
  return {
    id, einsatz_id: 1, ueber_abschnitt_id: ueber, name: `A${id}`, leiter_id: null,
    leiter_name: null, bemerkung: null, sortier: 0, sprechgruppen: [],
  } as unknown as Einsatzabschnitt;
}
function einheit(id: number, abschnittId: number | null, f: number, uf: number, m: number): Einheit {
  return {
    id, einsatz_id: 1, name: `E${id}`, abschnitt_id: abschnittId,
    ist: { fuehrer: f, unterfuehrer: uf, mannschaft: m },
    ist_kumuliert: { fuehrer: f, unterfuehrer: uf, mannschaft: m },
    sortier: 0, sprechgruppen: [], fahrzeug_mitglieder: [], personal_mitglieder: [], material_mitglieder: [],
  } as unknown as Einheit;
}

describe('nachfahrenInkl', () => {
  it('enthält den Abschnitt selbst und alle Nachfahren, nicht die Geschwister', () => {
    const a = [abschnitt(1, null), abschnitt(2, 1), abschnitt(3, 2), abschnitt(4, null)];
    expect([...nachfahrenInkl(a, 1)].sort()).toEqual([1, 2, 3]);
  });
});

describe('abschnittStaerken', () => {
  const a = [abschnitt(5, null), abschnitt(6, 5), abschnitt(7, 6)];
  const e = [einheit(1, 5, 1, 2, 3), einheit(2, 6, 0, 1, 1), einheit(3, 7, 0, 0, 2), einheit(4, null, 9, 9, 9)];

  it('„eigene" zählt nur die direkt zugeordneten Einheiten', () => {
    expect(abschnittStaerken(a, e, 5).eigene).toEqual({ fuehrer: 1, unterfuehrer: 2, mannschaft: 3 });
  });

  it('„inkl. Unterabschnitte" summiert über nachfahrenInkl — nicht zugeordnete Einheiten bleiben draußen', () => {
    expect(abschnittStaerken(a, e, 5).inklUnter).toEqual({ fuehrer: 1, unterfuehrer: 3, mannschaft: 6 });
  });

  it('ein Abschnitt ohne Unterabschnitte hat beide Werte gleich', () => {
    const s = abschnittStaerken(a, e, 7);
    expect(s.eigene).toEqual(s.inklUnter);
  });

  it('ohne Einheiten in der ganzen Teilgliederung sind beide null', () => {
    expect(abschnittStaerken([abschnitt(9, null)], e, 9)).toEqual({ eigene: null, inklUnter: null });
  });
});
