import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  darfFristSetzen,
  fristAusEingabe,
  istFristverkuerzung,
  liegtInDerVergangenheit,
} from './fristModell';

dayjs.extend(utc);

/**
 * Spiegel von `einsatz::berechtigung::ist_fristverkuerzung`: laufen Client und Server
 * auseinander, fragt der Client nicht und der Server lehnt ab — oder umgekehrt.
 */
describe('istFristverkuerzung (Spiegel des Servers)', () => {
  it('Aufheben ist nie eine Verkürzung', () => {
    expect(istFristverkuerzung('2026-10-01 00:00:00', null)).toBe(false);
    expect(istFristverkuerzung(null, null)).toBe(false);
  });

  it('erstmaliges Setzen an einem Einsatz ohne Frist ist eine Verkürzung', () => {
    expect(istFristverkuerzung(null, '2099-01-01 00:00:00')).toBe(true);
    expect(istFristverkuerzung(undefined, '2099-01-01 00:00:00')).toBe(true);
  });

  it('ein früherer Zeitpunkt ist eine Verkürzung, ein späterer oder gleicher nicht', () => {
    expect(istFristverkuerzung('2026-10-01 00:00:00', '2026-09-30 23:59:59')).toBe(true);
    expect(istFristverkuerzung('2026-10-01 00:00:00', '2026-10-01 00:00:01')).toBe(false);
    expect(istFristverkuerzung('2026-10-01 00:00:00', '2026-10-01 00:00:00')).toBe(false);
  });
});

describe('darfFristSetzen (Einsatzleitung oder System-Admin der Einsatz-Org, unabhängig vom Status)', () => {
  const admin = { system_rolle: 'admin' as const, org_id: 1 };
  const fremderAdmin = { system_rolle: 'admin' as const, org_id: 2 };
  const keiner = { system_rolle: 'keiner' as const, org_id: 1 };

  it('Einsatzleitung darf — auch am abgeschlossenen Einsatz', () => {
    expect(
      darfFristSetzen({ status: 'aktiv', meine_rolle: 'einsatzleitung', org_id: 1 }, keiner),
    ).toBe(true);
    expect(
      darfFristSetzen(
        { status: 'abgeschlossen', meine_rolle: 'einsatzleitung', org_id: 1 },
        keiner,
      ),
    ).toBe(true);
  });

  it('System-Admin der Einsatz-Org darf, auch ohne Mitgliedschaft', () => {
    expect(darfFristSetzen({ status: 'abgeschlossen', meine_rolle: null, org_id: 1 }, admin)).toBe(
      true,
    );
  });

  // LFH-753: Spiegel der Org-Prüfung am Frist-PUT — der Server antwortet dort 403.
  it('System-Admin einer fremden Org darf ohne Mitgliedschaft nicht', () => {
    expect(darfFristSetzen({ status: 'aktiv', meine_rolle: null, org_id: 1 }, fremderAdmin)).toBe(
      false,
    );
    expect(
      darfFristSetzen({ status: 'abgeschlossen', meine_rolle: null, org_id: 1 }, fremderAdmin),
    ).toBe(false);
    expect(darfFristSetzen(null, admin)).toBe(false);
  });

  it('Einsatzleitung einer fremden Org darf weiter', () => {
    expect(
      darfFristSetzen({ status: 'aktiv', meine_rolle: 'einsatzleitung', org_id: 1 }, fremderAdmin),
    ).toBe(true);
  });

  it('Führungspersonal und Beobachter dürfen nicht', () => {
    for (const rolle of ['fuehrungspersonal', 'beobachter'] as const) {
      expect(darfFristSetzen({ status: 'aktiv', meine_rolle: rolle, org_id: 1 }, keiner)).toBe(
        false,
      );
      expect(
        darfFristSetzen({ status: 'abgeschlossen', meine_rolle: rolle, org_id: 1 }, keiner),
      ).toBe(false);
    }
    expect(darfFristSetzen(undefined, undefined)).toBe(false);
  });
});

describe('fristAusEingabe (Minute des Pickers gegen Sekunden der gespeicherten Frist)', () => {
  it('dieselbe Minute gibt die gespeicherte Frist sekundengenau zurück', () => {
    expect(fristAusEingabe('2030-10-01 10:00:00', '2030-10-01 10:00:17')).toBe(
      '2030-10-01 10:00:17',
    );
  });
  it('eine andere Minute bleibt die Eingabe', () => {
    expect(fristAusEingabe('2030-10-01 09:59:00', '2030-10-01 10:00:17')).toBe(
      '2030-10-01 09:59:00',
    );
    expect(fristAusEingabe('2030-10-01 10:00:00', null)).toBe('2030-10-01 10:00:00');
  });
});

describe('liegtInDerVergangenheit', () => {
  const jetzt = dayjs.utc('2026-09-25 12:00:00');
  it('Grenze wie die Lesesperre: genau jetzt ist erreicht', () => {
    expect(liegtInDerVergangenheit('2026-09-25 12:00:00', jetzt)).toBe(true);
    expect(liegtInDerVergangenheit('2026-09-25 11:59:59', jetzt)).toBe(true);
    expect(liegtInDerVergangenheit('2026-09-25 12:00:01', jetzt)).toBe(false);
  });
});
