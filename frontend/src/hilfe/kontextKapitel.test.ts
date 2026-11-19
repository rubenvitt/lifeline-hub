import { describe, expect, it } from 'vitest';
import { RUECKFALL_KAPITEL, kapitelFuerPfad } from './kontextKapitel';

describe('kapitelFuerPfad', () => {
  it.each([
    ['/einsaetze/5/etb', 'einsatztagebuch'],
    ['/einsaetze/5/etb/12', 'einsatztagebuch'],
    ['/einsaetze/5/lagekarte', 'lagekarte'],
    ['/einsaetze/5/gefahren', 'gefahren'],
    ['/einsaetze/5/stab/funkplan', 'funkplan'],
    ['/einsaetze/5/einstellungen/geraete', 'geraete-koppeln'],
    ['/einsaetze/5/einstellungen/zugriff', 'rechte-im-einsatz'],
    ['/einsaetze/5/einstellungen', 'einsatz-einstellungen'],
    ['/einsaetze/5/einstellungen/allgemein', 'einsatz-einstellungen'],
    ['/einsaetze', 'einsatz-oberflaeche'],
    ['/planungen/3', 'vorplanung'],
    ['/profil', 'profil-sicherheit'],
    ['/admin/stammdaten/personal/3', 'stammdaten'],
    ['/admin/benutzer', 'benutzer'],
    ['/admin/einstellungen/anbindungen/7', 'anbindungen'],
    ['/admin/einstellungen/instanzkopplung', 'instanzkopplung'],
    ['/admin/karten/online', 'karten'],
    ['/admin', 'verwaltung'],
    ['/admin/einstellungen/anzeige', 'verwaltung'],
  ])('%s → %s', (pfad, kapitel) => {
    expect(kapitelFuerPfad(pfad)).toBe(kapitel);
  });

  it('fällt bei unbekannten Pfaden auf die Einsatz-Oberfläche zurück', () => {
    expect(RUECKFALL_KAPITEL).toBe('einsatz-oberflaeche');
    expect(kapitelFuerPfad('/gibtsnicht')).toBe(RUECKFALL_KAPITEL);
    expect(kapitelFuerPfad('/einsaetze/5/unbekannt')).toBe(RUECKFALL_KAPITEL);
    expect(kapitelFuerPfad('/')).toBe(RUECKFALL_KAPITEL);
  });

  it('ignoriert einen abschließenden Schrägstrich', () => {
    expect(kapitelFuerPfad('/profil/')).toBe('profil-sicherheit');
  });
});
