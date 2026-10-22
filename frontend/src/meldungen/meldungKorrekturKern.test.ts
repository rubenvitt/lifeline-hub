import { describe, expect, it } from 'vitest';
import type { Meldung } from '../api/types';
import {
  istLeer,
  korrekturAenderung,
  korrekturStartwerte,
  lageAenderung,
  vonWert,
  wirdHeraufgestuft,
} from './meldungKorrekturKern';

const meldung = (over: Partial<Meldung> = {}): Meldung =>
  ({
    id: 1,
    lfd_nr: 12,
    meldungsart: 'sonstige',
    prioritaet: 'normal',
    richtung: 'intern',
    empfaenger: 'ELW 1',
    einheit_id: undefined,
    abschnitt_id: undefined,
    ...over,
  }) as Meldung;

describe('meldungKorrekturKern', () => {
  it('sendet nur die geänderten Felder', () => {
    const m = meldung();
    const w = korrekturStartwerte(m);
    expect(istLeer(korrekturAenderung(m, w))).toBe(true);
    expect(
      korrekturAenderung(m, { ...w, prioritaet: 'dringend', meldungsart: 'lagemeldung' }),
    ).toEqual({ prioritaet: 'dringend', meldungsart: 'lagemeldung' });
  });

  it('sendet den Von-Bezug als Paar und löst ihn mit null', () => {
    const m = meldung({ einheit_id: 4 });
    const w = korrekturStartwerte(m);
    expect(w.von).toBe('einheit:4');
    expect(korrekturAenderung(m, { ...w, von: 'abschnitt:2' })).toEqual({
      einheit_id: null,
      abschnitt_id: 2,
    });
    expect(korrekturAenderung(m, { ...w, von: undefined })).toEqual({
      einheit_id: null,
      abschnitt_id: null,
    });
    expect(vonWert(meldung({ abschnitt_id: 3 }))).toBe('abschnitt:3');
  });

  it('leert den Empfänger mit null und vergleicht getrimmt', () => {
    const m = meldung();
    const w = korrekturStartwerte(m);
    expect(istLeer(korrekturAenderung(m, { ...w, empfaenger: ' ELW 1 ' }))).toBe(true);
    expect(korrekturAenderung(m, { ...w, empfaenger: '  ' })).toEqual({ empfaenger: null });
    expect(korrekturAenderung(meldung({ empfaenger: null }), { ...w, empfaenger: '' })).toEqual({});
  });

  it('erkennt das Heraufstufen zur Sofortmeldung, über Priorität oder Art (LLH-1380)', () => {
    const m = meldung();
    const w = korrekturStartwerte(m);
    expect(wirdHeraufgestuft(m, w)).toBe(false);
    expect(wirdHeraufgestuft(m, { ...w, prioritaet: 'sofort' })).toBe(true);
    expect(wirdHeraufgestuft(m, { ...w, meldungsart: 'sofortmeldung' })).toBe(true);
    expect(wirdHeraufgestuft(m, { ...w, prioritaet: 'dringend' })).toBe(false);
    // Schon sofort: die Art dazu ist kein Heraufstufen.
    const sofort = meldung({ prioritaet: 'sofort' });
    expect(
      wirdHeraufgestuft(sofort, { ...korrekturStartwerte(sofort), meldungsart: 'sofortmeldung' }),
    ).toBe(false);
  });

  it('Lage-Angaben: nur Geändertes, leerer Text und entfernter Ort', () => {
    const vorher = { text: 'Brücke gesperrt', lat: 52, lon: 9 };
    expect(lageAenderung(vorher, { text: 'Brücke gesperrt ', ort: { lat: 52, lon: 9 } })).toEqual(
      {},
    );
    expect(lageAenderung(vorher, { text: '', ort: { lat: 52, lon: 9 } })).toEqual({
      lage_text: '',
    });
    expect(lageAenderung(vorher, { text: 'Brücke gesperrt', ort: null })).toEqual({
      lat: null,
      lon: null,
    });
    expect(
      lageAenderung({ text: 'x', lat: null, lon: null }, { text: 'x', ort: { lat: 1, lon: 2 } }),
    ).toEqual({ lat: 1, lon: 2 });
  });
});

describe('meldungKorrekturKern — Empfängerfunktion (LLH-1381)', () => {
  it('sendet eine geänderte Funktion und leert mit null', () => {
    const m = meldung({ empfaenger_funktion: 's3' });
    const w = korrekturStartwerte(m);
    expect(w.empfaenger_funktion).toBe('s3');
    expect(istLeer(korrekturAenderung(m, w))).toBe(true);
    expect(korrekturAenderung(m, { ...w, empfaenger_funktion: 's2' })).toEqual({
      empfaenger_funktion: 's2',
    });
    expect(korrekturAenderung(m, { ...w, empfaenger_funktion: undefined })).toEqual({
      empfaenger_funktion: null,
    });
    const ohne = meldung();
    expect(istLeer(korrekturAenderung(ohne, korrekturStartwerte(ohne)))).toBe(true);
  });
});
