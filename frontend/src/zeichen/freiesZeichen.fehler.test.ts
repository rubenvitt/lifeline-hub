import { afterEach, describe, expect, it, vi } from 'vitest';

// Die Stufen „ohne Organisation“ und „Körper allein“ greift mit @einsatzzeichen 5.2 kein
// Altzeichen: jeder Körper nimmt jede Organisation an. Sie stehen für eine künftige Sperrregel
// (Spec `lagekarte-taktische-zeichen`, „Definierter Rückfall statt Ausfall“). Belegt werden sie
// hier mit einer Bibliothek, die solche Regeln vorspielt (Muster `fachobjektZeichen.fehler.test.ts`).
const sperre = vi.hoisted(() => ({ feld: '' as string, fremd: false }));

vi.mock('@einsatzzeichen/core', async (original) => {
  const echt = await original<typeof import('@einsatzzeichen/core')>();
  return {
    ...echt,
    drawAnySpec: vi.fn((spec: Record<string, unknown>) => {
      if (sperre.feld && spec[sperre.feld] !== undefined) {
        if (sperre.fremd) throw new TypeError('kaputt');
        throw new echt.CompositionError([
          { rule: 'test-sperre', message: `gesperrt: ${sperre.feld}` } as never,
        ]);
      }
      return echt.drawAnySpec(spec as unknown as Parameters<typeof echt.drawAnySpec>[0]);
    }),
  };
});

const { freiesZeichen } = await import('./freiesZeichen');

describe('freiesZeichen — Stufen für künftige Sperrregeln', () => {
  afterEach(() => {
    sperre.feld = '';
    sperre.fremd = false;
    vi.restoreAllMocks();
  });

  it('lässt eine gesperrte Organisation weg und behält die Fahrzeugkategorie', () => {
    sperre.feld = 'organization';
    const z = freiesZeichen({ grundzeichen: 'kraftfahrzeug-landgebunden', organisation: 'thw' });
    expect(z.spec).toEqual({ kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1' });
    expect(z.vereinfacht).toBe(true);
  });

  it('fällt auf den Körper allein, wenn auch die Kategorie gesperrt ist', () => {
    sperre.feld = 'vehicleCategory';
    const z = freiesZeichen({ grundzeichen: 'kettenfahrzeug', organisation: 'polizei' });
    expect(z.spec).toEqual({ kind: 'vehicle-land' });
    expect(z.vereinfacht).toBe(true);
  });

  it('läuft bei einer gespeicherten Spec die Stufe ohne Symbol', () => {
    sperre.feld = 'states';
    const z = freiesZeichen({
      zeichen_spec:
        '{"v":1,"spec":{"bodyMarks":["cbrn-protection"],"kind":"hazard","states":["acute-situation"]}}',
    });
    expect(z.spec).toEqual({ kind: 'hazard', bodyMarks: ['cbrn-protection'] });
    expect(z.vereinfacht).toBe(true);
  });

  it.each<[string, string, Record<string, unknown>, Record<string, unknown>]>([
    [
      'ohne Fachaufgabe',
      'bodyMarks',
      { kind: 'formation', organization: 'thw', strength: 'gruppe', bodyMarks: ['fire-fighting'] },
      { kind: 'formation', organization: 'thw', strength: 'gruppe' },
    ],
    [
      'ohne Farbe',
      'technicalFill',
      { kind: 'circle-12', bodyVariant: 'raised-gable', technicalFill: 'rot' },
      { kind: 'circle-12', bodyVariant: 'raised-gable' },
    ],
    [
      'Körper allein',
      'vehicleCategory',
      { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1', organization: 'thw' },
      { kind: 'vehicle-land' },
    ],
  ])('läuft bei einer gespeicherten Spec die Stufe %s', (_stufe, feld, gespeichert, erwartet) => {
    sperre.feld = feld;
    const z = freiesZeichen({ zeichen_spec: JSON.stringify({ v: 1, spec: gespeichert }) });
    expect(z.spec).toEqual(erwartet);
    expect(z.vereinfacht).toBe(true);
  });

  it('fällt bei einem unerwarteten Fehler zurück und warnt in DEV', () => {
    sperre.feld = 'organization';
    sperre.fremd = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const z = freiesZeichen({ grundzeichen: 'gebaeude', organisation: 'zivil' });
    expect(z.spec).toEqual({ kind: 'building' });
    expect(warn).toHaveBeenCalledWith(
      '[freiesZeichen] unerwarteter Fehler beim Zeichnen',
      expect.objectContaining({ organization: 'zivile-einheiten' }),
      expect.any(TypeError),
    );
  });
});
