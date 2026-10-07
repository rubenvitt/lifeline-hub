import { describe, it, expect } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import type { Auftrag } from '../api/types';
import { ersetzeAuftraege, findeAuftrag } from './auftragCache';

/** Optimistische Updates über den Prefix `auftraege` behalten jede Cache-Form (LFH-1071, D5). */

const a = (id: number, text = `Auftrag ${id}`) =>
  ({ id, auftrag_text: text, empfaenger: [] }) as unknown as Auftrag;
const umbenennen = (x: Auftrag) => (x.id === 2 ? { ...x, auftrag_text: 'neu' } : x);

describe('auftragCache', () => {
  it('ändert Listen, Seitenketten und Einzelabrufe', () => {
    expect(ersetzeAuftraege([a(1), a(2)], umbenennen)).toEqual([a(1), a(2, 'neu')]);

    const kette: InfiniteData<Auftrag[], unknown> = {
      pages: [[a(1)], [a(2)]],
      pageParams: [undefined, { zeit: 'x', id: 1 }],
    };
    expect(ersetzeAuftraege(kette, umbenennen)).toEqual({
      pages: [[a(1)], [a(2, 'neu')]],
      pageParams: kette.pageParams,
    });

    expect(ersetzeAuftraege(a(2), umbenennen)).toEqual(a(2, 'neu'));
  });

  it('lässt Kennzahlen und Leeres unberührt', () => {
    const kennzahlen = { offen: 3, abgeschlossen: 4 };
    expect(ersetzeAuftraege(kennzahlen, umbenennen)).toBe(kennzahlen);
    expect(ersetzeAuftraege(undefined, umbenennen)).toBeUndefined();
  });

  it('findet einen Auftrag in jeder Form', () => {
    expect(findeAuftrag([a(1), a(2)], 2)?.id).toBe(2);
    expect(findeAuftrag({ pages: [[a(1)], [a(2)]], pageParams: [] }, 2)?.id).toBe(2);
    expect(findeAuftrag(a(2), 2)?.id).toBe(2);
    expect(findeAuftrag(a(2), 3)).toBeUndefined();
    expect(findeAuftrag({ offen: 1, abgeschlossen: 0 }, 1)).toBeUndefined();
  });
});
