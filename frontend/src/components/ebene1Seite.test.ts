import { describe, expect, it } from 'vitest';
import { ebene1Seite } from './ebene1Seite';

describe('ebene1Seite', () => {
  it('Einsatzliste: Titel ohne Ortspfad', () => {
    expect(ebene1Seite('/einsaetze')).toEqual({ titel: ['Einsätze'], ort: null });
  });

  it('Profil', () => {
    expect(ebene1Seite('/profil')).toEqual({ titel: ['Profil'], ort: ['Profil'] });
  });

  it('Verwaltung: Sektion aus der Admin-Registry, auch auf Detailadressen', () => {
    expect(ebene1Seite('/admin/stammdaten/fahrzeuge')).toEqual({
      titel: ['Fahrzeuge', 'Verwaltung'],
      ort: ['Verwaltung', 'Fahrzeuge'],
    });
    expect(ebene1Seite('/admin/stammdaten/fahrzeuge/12').titel).toEqual([
      'Fahrzeuge',
      'Verwaltung',
    ]);
    expect(ebene1Seite('/admin/einstellungen/anzeige').titel).toEqual(['Anzeige', 'Verwaltung']);
  });

  it('Verwaltung: Sondereinträge', () => {
    expect(ebene1Seite('/admin/benutzer').titel).toEqual(['Benutzer', 'Verwaltung']);
    expect(ebene1Seite('/admin/demo-daten').titel).toEqual(['Demo-Daten', 'Verwaltung']);
    expect(ebene1Seite('/admin/aufbewahrung/4').titel).toEqual(['Aufbewahrung', 'Verwaltung']);
  });

  it('Verwaltung ohne bekannte Sektion nennt nur den Bereich', () => {
    expect(ebene1Seite('/admin')).toEqual({ titel: ['Verwaltung'], ort: ['Verwaltung'] });
  });

  it('unbekannte Adresse: kein Teil', () => {
    expect(ebene1Seite('/irgendwo')).toEqual({ titel: [], ort: null });
  });
});
