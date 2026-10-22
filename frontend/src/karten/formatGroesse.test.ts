import { describe, expect, it } from 'vitest';
import { formatGroesse } from './formatGroesse';

describe('formatGroesse (LLH-1146: deutsche Zahlendarstellung)', () => {
  it('zeigt Nachkommastellen mit Dezimalkomma', () => {
    expect(formatGroesse(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(formatGroesse(2048)).toBe('2,0 KB');
    expect(formatGroesse(3.25 * 1024 ** 3)).toBe('3,3 GB');
  });

  it('hält die KB-Stellen des Aufrufers (Chat: ganze Zahlen)', () => {
    expect(formatGroesse(1536, 0)).toBe('2 KB');
  });

  it('gruppiert Tausender mit Punkt, wie im Deutschen üblich', () => {
    expect(formatGroesse(1000)).toBe('1.000 B');
    expect(formatGroesse(1023.5 * 1024)).toBe('1.023,5 KB');
  });

  it('liefert für eine unbekannte Größe den Gedankenstrich', () => {
    expect(formatGroesse(null)).toBe('—');
    expect(formatGroesse(undefined)).toBe('—');
  });
});
