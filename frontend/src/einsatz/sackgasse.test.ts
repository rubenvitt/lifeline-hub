import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { sackgasseBeiFehler } from './sackgasse';

const KEIN_ZUGRIFF = {
  titel: 'Kein Zugriff auf diesen Einsatz',
  hinweis: 'Zugriff vergibt die Einsatzleitung dieses Einsatzes.',
  wiederholbar: false,
  gesperrt: true,
};

describe('sackgasseBeiFehler (LLH-1819)', () => {
  it('403 kein_mitglied nennt die Einsatzleitung und bietet keinen Neuversuch', () => {
    const e = new ApiError(403, 'Keine Berechtigung', { grund: 'kein_mitglied' });
    expect(sackgasseBeiFehler(e)).toEqual(KEIN_ZUGRIFF);
  });

  it('403 ohne Grund (älterer Server) liest sich wie kein_mitglied', () => {
    expect(sackgasseBeiFehler(new ApiError(403, 'Keine Berechtigung'))).toEqual(KEIN_ZUGRIFF);
  });

  it('403 nachlauf_abgelaufen sagt, dass nur noch die Einsatzleitung einsieht', () => {
    const e = new ApiError(403, 'Keine Berechtigung', { grund: 'nachlauf_abgelaufen' });
    expect(sackgasseBeiFehler(e)).toEqual({
      titel: 'Einsatz nicht mehr einsehbar',
      hinweis:
        'Die Lesefrist nach Abschluss ist abgelaufen. Einsehen kann ihn nur noch die Einsatzleitung.',
      wiederholbar: false,
      gesperrt: true,
    });
  });

  it('403 nicht_mehr_lesbar nennt die abgelaufene Aufbewahrungsfrist', () => {
    const e = new ApiError(403, 'Keine Berechtigung', { grund: 'nicht_mehr_lesbar' });
    expect(sackgasseBeiFehler(e)).toEqual({
      titel: 'Einsatz nicht mehr einsehbar',
      hinweis: 'Die Aufbewahrungsfrist ist abgelaufen.',
      wiederholbar: false,
      gesperrt: true,
    });
  });

  it('404 heißt „nicht gefunden“, ohne Neuversuch', () => {
    expect(sackgasseBeiFehler(new ApiError(404, 'Nicht gefunden'))).toEqual({
      titel: 'Einsatz nicht gefunden',
      wiederholbar: false,
      gesperrt: true,
    });
  });

  it('ein Serverfehler bleibt wiederholbar und trägt die Servermeldung', () => {
    expect(sackgasseBeiFehler(new ApiError(500, 'Interner Fehler'))).toEqual({
      titel: 'Einsatz konnte nicht geladen werden',
      hinweis: 'Interner Fehler',
      wiederholbar: true,
      gesperrt: false,
    });
  });

  it('ein Netzfehler bleibt wiederholbar, ohne technische Meldung', () => {
    expect(sackgasseBeiFehler(new TypeError('Failed to fetch'))).toEqual({
      titel: 'Einsatz konnte nicht geladen werden',
      wiederholbar: true,
      gesperrt: false,
    });
  });
});
