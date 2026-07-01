import { describe, expect, it, beforeEach } from 'vitest';
import {
  waehleInitialeBasemap,
  merkeLetzteBasemap,
  liesLetzteBasemap,
  type GespeicherteBasemap,
} from './basemapAuswahl';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';

function view(name: string): OnlineStyle {
  return { name, url: `https://example/${name}`, typ: 'vektor', attribution: null };
}

function config(over: Partial<KarteServerConfig> = {}): KarteServerConfig {
  return {
    online_styles: [view('Liberty'), view('basemap.de')],
    offline_verfuegbar: false,
    offline_tiles_url: null,
    offline_attribution: null,
    ...over,
  };
}

describe('waehleInitialeBasemap', () => {
  it('nimmt ohne gemerkte Wahl den Verfügbarkeits-Default (online + erster View)', () => {
    expect(waehleInitialeBasemap(config(), null)).toEqual({ modus: 'online', onlineView: 'Liberty' });
  });

  it('fällt ohne Online auf offline zurück, wenn offline verfügbar', () => {
    const c = config({ online_styles: [], offline_verfuegbar: true, offline_tiles_url: '/x.pmtiles' });
    expect(waehleInitialeBasemap(c, null)).toEqual({ modus: 'offline', onlineView: null });
  });

  it('fällt ohne Online und ohne offline auf blind zurück', () => {
    expect(waehleInitialeBasemap(config({ online_styles: [] }), null)).toEqual({ modus: 'blind', onlineView: null });
  });

  it('bevorzugt die gemerkte Wahl, wenn gegen die Config gültig', () => {
    const gespeichert: GespeicherteBasemap = { modus: 'online', onlineView: 'basemap.de' };
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual(gespeichert);
  });

  it('behält den gemerkten Modus, ersetzt aber einen entfernten Online-View durch den ersten', () => {
    const gespeichert: GespeicherteBasemap = { modus: 'online', onlineView: 'Weg' };
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual({ modus: 'online', onlineView: 'Liberty' });
  });

  it('verwirft gemerktes offline, wenn offline nicht (mehr) verfügbar', () => {
    const gespeichert: GespeicherteBasemap = { modus: 'offline', onlineView: 'Liberty' };
    // offline_verfuegbar=false → offline ungültig → Default online
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual({ modus: 'online', onlineView: 'Liberty' });
  });

  it('verwirft gemerktes online, wenn keine Online-Views (mehr) existieren', () => {
    const gespeichert: GespeicherteBasemap = { modus: 'online', onlineView: 'Liberty' };
    const c = config({ online_styles: [], offline_verfuegbar: true, offline_tiles_url: '/x.pmtiles' });
    expect(waehleInitialeBasemap(c, gespeichert)).toEqual({ modus: 'offline', onlineView: null });
  });

  it('behält gemerktes blind und setzt den ersten Online-View als Switcher-Vorgabe', () => {
    expect(waehleInitialeBasemap(config(), { modus: 'blind', onlineView: null }))
      .toEqual({ modus: 'blind', onlineView: 'Liberty' });
  });

  it('nutzt den Einsatz-Default, wenn keine gemerkte Wahl existiert', () => {
    const c = config({ offline_verfuegbar: true, offline_tiles_url: '/x.pmtiles' });
    expect(waehleInitialeBasemap(c, null, 'offline')).toEqual({ modus: 'offline', onlineView: 'Liberty' });
  });

  it('ignoriert einen ungültigen Einsatz-Default und nimmt den Verfügbarkeits-Default', () => {
    // offline als Einsatz-Default, aber offline nicht verfügbar → online-Default.
    expect(waehleInitialeBasemap(config(), null, 'offline')).toEqual({ modus: 'online', onlineView: 'Liberty' });
  });

  it('gemerkte Wahl schlägt den Einsatz-Default', () => {
    const c = config({ offline_verfuegbar: true, offline_tiles_url: '/x.pmtiles' });
    expect(waehleInitialeBasemap(c, { modus: 'blind', onlineView: null }, 'offline'))
      .toEqual({ modus: 'blind', onlineView: 'Liberty' });
  });
});

describe('letzte-Basemap-Speicher', () => {
  beforeEach(() => localStorage.clear());

  it('merkt und liest die zuletzt gewählte Karte pro Einsatz', () => {
    merkeLetzteBasemap(1, { modus: 'blind', onlineView: null });
    merkeLetzteBasemap(2, { modus: 'online', onlineView: 'basemap.de' });
    expect(liesLetzteBasemap(1)).toEqual({ modus: 'blind', onlineView: null });
    expect(liesLetzteBasemap(2)).toEqual({ modus: 'online', onlineView: 'basemap.de' });
  });

  it('liefert null, wenn für den Einsatz noch nichts gemerkt wurde', () => {
    expect(liesLetzteBasemap(99)).toBeNull();
  });

  it('liefert null bei kaputtem/fremdem Inhalt', () => {
    localStorage.setItem('basemap:letzteAuswahl:5', '{kein json');
    expect(liesLetzteBasemap(5)).toBeNull();
    localStorage.setItem('basemap:letzteAuswahl:6', JSON.stringify({ modus: 'satellit' }));
    expect(liesLetzteBasemap(6)).toBeNull();
  });
});
