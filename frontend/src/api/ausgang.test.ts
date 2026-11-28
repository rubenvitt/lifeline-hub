import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { anbindungKanaele, anbindungTexte, ausgangKanal, versandFehler } from './ausgang';

describe('Ausgang: Kanal einer Ablehnung (LLH-2096)', () => {
  it('anbindungKanaele_liest_beide_aus_der_meldung', () => {
    const e = new ApiError(
      422,
      'Kein Matrix-Konto eingerichtet; Kein Threema-Gateway eingerichtet',
      { grund: 'anbindung_fehlt' },
    );
    expect(anbindungKanaele(e, ['matrix', 'threema', 'email'])).toEqual(['matrix', 'threema']);
  });

  it('ein_gesendeter_kanal_ist_dieser', () => {
    const e = new ApiError(422, 'Anbindung fehlt', { grund: 'anbindung_fehlt' });
    expect(anbindungKanaele(e, ['threema'])).toEqual(['threema']);
  });

  it('ohne_hinweis_gilt_die_mail', () => {
    const e = new ApiError(422, 'Kein Mailserver eingerichtet', { grund: 'anbindung_fehlt' });
    expect(anbindungKanaele(e, ['email', 'matrix'])).toEqual(['email']);
  });

  it('threema_ist_ein_eigener_kanal', () => {
    expect(ausgangKanal('threema')).toBe('threema');
  });
});

describe('Ausgang: Text je Kanal einer gemeinsamen Ablehnung (LLH-2096)', () => {
  it('nimmt_je_kanal_den_text_des_servers', () => {
    const e = new ApiError(
      422,
      'Das Matrix-Konto ist angehalten; Kein Threema-Gateway eingerichtet',
      { grund: 'anbindung_angehalten' },
    );
    expect(anbindungTexte(e, ['matrix', 'threema'])).toEqual({
      matrix: 'Das Matrix-Konto ist angehalten',
      threema: 'Kein Threema-Gateway eingerichtet',
    });
    const v = versandFehler(e, ['matrix', 'threema']) as ApiError;
    expect(v.message).toBe('Das Matrix-Konto ist angehalten; Kein Threema-Gateway eingerichtet');
  });
});
