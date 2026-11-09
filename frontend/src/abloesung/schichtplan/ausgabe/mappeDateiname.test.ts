import { describe, expect, it } from 'vitest';
import { dateinamenTeil, mappeDateiname } from './mappeDateiname';

describe('mappeDateiname (LLH-1557)', () => {
  it('löst Umlaute auf und bleibt ASCII', () => {
    expect(dateinamenTeil('ÜBUNG – Sanitätsdienst Stadtfest Musterstadt')).toBe(
      'uebung-sanitaetsdienst-stadtfest-musterstadt',
    );
    expect(dateinamenTeil('Straße 3 / Café')).toBe('strasse-3-cafe');
  });

  it('kürzt lange Namen ohne Bindestrich am Ende', () => {
    const teil = dateinamenTeil(`${'a'.repeat(59)} b`);
    expect(teil).toBe('a'.repeat(59));
  });

  it('nennt den lokalen Tag und nimmt ohne Namen den Ersatz', () => {
    const jetzt = new Date(2026, 7, 5, 23, 30);
    expect(mappeDateiname('Stadtfest', 'einsatz-4', jetzt)).toBe(
      'schichtplan-stadtfest-2026-08-05.xlsx',
    );
    expect(mappeDateiname('–––', 'einsatz-4', jetzt)).toBe('schichtplan-einsatz-4-2026-08-05.xlsx');
  });
});
