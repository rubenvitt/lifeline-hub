import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt } from '../../api/types';
import { abschnittStaerken, einheitenImAbschnitt, nachfahrenInkl } from './abschnittStaerke';

function abschnitt(id: number, ueber: number | null): Einsatzabschnitt {
  return {
    id,
    einsatz_id: 1,
    ueber_abschnitt_id: ueber,
    name: `A${id}`,
    leiter_id: null,
    leiter_name: null,
    bemerkung: null,
    sortier: 0,
    sprechgruppen: [],
  } as unknown as Einsatzabschnitt;
}
function einheit(
  id: number,
  abschnittId: number | null,
  f: number,
  uf: number,
  m: number,
): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `E${id}`,
    abschnitt_id: abschnittId,
    ist: { fuehrer: f, unterfuehrer: uf, mannschaft: m },
    ist_kumuliert: { fuehrer: f, unterfuehrer: uf, mannschaft: m },
    sortier: 0,
    sprechgruppen: [],
    verbindungen: [],
    fahrzeug_mitglieder: [],
    personal_mitglieder: [],
    material_mitglieder: [],
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
  const e = [
    einheit(1, 5, 1, 2, 3),
    einheit(2, 6, 0, 1, 1),
    einheit(3, 7, 0, 0, 2),
    einheit(4, null, 9, 9, 9),
  ];

  it('„eigene" zählt nur die direkt zugeordneten Einheiten', () => {
    expect(abschnittStaerken(a, e, 5).eigene).toEqual({
      fuehrer: 1,
      unterfuehrer: 2,
      mannschaft: 3,
    });
  });

  it('„inkl. Unterabschnitte" summiert über nachfahrenInkl — nicht zugeordnete Einheiten bleiben draußen', () => {
    expect(abschnittStaerken(a, e, 5).inklUnter).toEqual({
      fuehrer: 1,
      unterfuehrer: 3,
      mannschaft: 6,
    });
  });

  it('ein Abschnitt ohne Unterabschnitte hat beide Werte gleich', () => {
    const s = abschnittStaerken(a, e, 7);
    expect(s.eigene).toEqual(s.inklUnter);
  });

  it('ohne Einheiten in der ganzen Teilgliederung sind beide null', () => {
    expect(abschnittStaerken([abschnitt(9, null)], e, 9)).toEqual({
      eigene: null,
      inklUnter: null,
    });
  });

  describe('ein Abschnitt zählt, wer in ihm steht (LLH-1744)', () => {
    const unter = (
      id: number,
      abschnittId: number | null,
      ueber: number,
      f: number,
      uf: number,
      m: number,
    ) => ({ ...einheit(id, abschnittId, f, uf, m), ueber_einheit_id: ueber }) as Einheit;
    // A (1/1/2) im Abschnitt 5; B (0/1/3) ist A unterstellt. A kumuliert 1/2/5.
    const a5 = [abschnitt(5, null), abschnitt(6, null)];
    const oben = {
      ...einheit(1, 5, 1, 1, 2),
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 5 },
    } as Einheit;

    it('gleicher Abschnitt: 1/2/5, nicht 1/3/8', () => {
      const s = abschnittStaerken(a5, [oben, unter(2, 5, 1, 0, 1, 3)], 5);
      expect(s.eigene).toEqual({ fuehrer: 1, unterfuehrer: 2, mannschaft: 5 });
      expect(s.inklUnter).toEqual({ fuehrer: 1, unterfuehrer: 2, mannschaft: 5 });
    });

    it('anderer Abschnitt: die Untereinheit zählt dort, die Obereinheit nur sich selbst', () => {
      const e2 = [oben, unter(2, 6, 1, 0, 1, 3)];
      expect(abschnittStaerken(a5, e2, 5).eigene).toEqual({
        fuehrer: 1,
        unterfuehrer: 1,
        mannschaft: 2,
      });
      expect(abschnittStaerken(a5, e2, 6)).toEqual({
        eigene: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
        inklUnter: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
      });
    });

    it('ohne eigenen Abschnitt erbt die Untereinheit den ihrer Obereinheit', () => {
      const e2 = [oben, unter(2, null, 1, 0, 1, 3)];
      expect(abschnittStaerken(a5, e2, 5).eigene).toEqual({
        fuehrer: 1,
        unterfuehrer: 2,
        mannschaft: 5,
      });
      expect(abschnittStaerken(a5, e2, 6).eigene).toBeNull();
    });

    it('unter einer aufgelösten Obereinheit erbt sie nichts, und die aufgelöste zählt nicht', () => {
      const weg = { ...oben, aufgeloest_at: '2026-11-16T08:00:00Z' } as Einheit;
      const e2 = [weg, unter(2, null, 1, 0, 1, 3)];
      expect(abschnittStaerken(a5, e2, 5).eigene).toBeNull();
    });
  });
});

describe('einheitenImAbschnitt', () => {
  const unter = (id: number, abschnittId: number | null, ueber: number) =>
    ({ ...einheit(id, abschnittId, 0, 0, 1), ueber_einheit_id: ueber }) as Einheit;

  it('nennt die Einheiten mit diesem wirksamen Abschnitt, ohne Unterabschnitte und ohne aufgelöste', () => {
    const e = [
      einheit(1, 5, 1, 0, 0),
      unter(2, null, 1), // erbt 5
      unter(3, 6, 1), // eigener Abschnitt 6
      { ...einheit(4, 5, 0, 0, 1), aufgeloest_at: '2026-11-16T08:00:00Z' } as Einheit,
    ];
    expect(einheitenImAbschnitt(e, 5).map((x) => x.id)).toEqual([1, 2]);
    expect(einheitenImAbschnitt(e, 6).map((x) => x.id)).toEqual([3]);
  });
});
