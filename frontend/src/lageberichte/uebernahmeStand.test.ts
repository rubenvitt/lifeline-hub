import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormInstance } from 'antd';
import { VORLAGEN } from './vorlagen';
import {
  UEBERNOMMEN_FIELD,
  isAusVorfassung,
  standFeld,
  standJetzt,
  verwerfeStandGeleerter,
} from './uebernahmeStand';

afterEach(() => {
  vi.useRealTimers();
});

/** Ein Formular als Karte, genug für `getFieldValue`/`setFieldValue` mit Namenspfad. */
function formAus(werte: Record<string, unknown>) {
  const pfad = (name: unknown) => (Array.isArray(name) ? name.join('.') : String(name));
  const store = new Map(Object.entries(werte));
  return {
    store,
    form: {
      getFieldValue: (name: unknown) => store.get(pfad(name)),
      setFieldValue: vi.fn((name: unknown, wert: unknown) => store.set(pfad(name), wert)),
    } as unknown as FormInstance,
  };
}

describe('Stand der Übernahme (LLH-1357)', () => {
  it('kein Abschnitt einer Vorlage heißt wie das Feld der Stände', () => {
    expect(
      VORLAGEN.flatMap((v) => v.abschnitte).filter((a) => a.schluessel === UEBERNOMMEN_FIELD),
    ).toEqual([]);
  });

  it('nennt jetzt im Wire-Format, UTC ohne Zonenkennung', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:30:15+02:00'));
    expect(standJetzt()).toBe('2026-10-21 10:30:15');
  });

  it('feldname je Abschnitt', () => {
    expect(standFeld('eigene_lage')).toEqual(['uebernommen_at', 'eigene_lage']);
  });

  it('ein Stand vor dem Anlegen der Fortschreibung stammt aus der Vorfassung', () => {
    expect(isAusVorfassung('2026-10-21 09:55:00', '2026-10-21 11:50:00')).toBe(true);
    expect(isAusVorfassung('2026-10-21 11:51:00', '2026-10-21 11:50:00')).toBe(false);
  });

  it('ohne Vorfassung ist kein Stand auffällig', () => {
    expect(isAusVorfassung('2020-01-01 00:00:00', undefined)).toBe(false);
  });

  it('ein geleerter Abschnitt verliert seinen Stand, ein bearbeiteter behält ihn', () => {
    const { form, store } = formAus({
      'uebernommen_at.eigene_lage': '2026-10-21 10:30:00',
      'uebernommen_at.medienlage': '2026-10-21 10:31:00',
    });
    verwerfeStandGeleerter(form, { eigene_lage: '  \n', medienlage: 'ergänzt' });
    expect(store.get('uebernommen_at.eigene_lage')).toBeUndefined();
    expect(store.get('uebernommen_at.medienlage')).toBe('2026-10-21 10:31:00');
  });

  it('ein geleerter Abschnitt ohne Stand bleibt unberührt', () => {
    const { form } = formAus({});
    verwerfeStandGeleerter(form, { auftrag: '', titel: 'x' });
    expect(form.setFieldValue).not.toHaveBeenCalled();
  });
});
