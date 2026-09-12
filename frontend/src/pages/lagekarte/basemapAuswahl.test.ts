import { describe, expect, it } from 'vitest';
import { waehleInitialeBasemap, type GespeicherteBasemap } from './basemapAuswahl';
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
    // LFH-265: Pflichtfeld im generierten Schema — leere Liste = keine Region bereit.
    offline_regionen: [],
    karten_bau_verfuegbar: false,
    ...over,
  };
}

describe('waehleInitialeBasemap', () => {
  it('nimmt ohne gemerkte Wahl den Verfügbarkeits-Default (online + erster View, Theme auto)', () => {
    expect(waehleInitialeBasemap(config(), null)).toEqual({
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'auto',
    });
  });

  it('fällt ohne Online auf offline zurück, wenn offline verfügbar', () => {
    const c = config({
      online_styles: [],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=x',
    });
    expect(waehleInitialeBasemap(c, null)).toEqual({
      modus: 'offline',
      onlineView: null,
      kartenTheme: 'auto',
    });
  });

  it('fällt ohne Online und ohne offline auf blind zurück', () => {
    expect(waehleInitialeBasemap(config({ online_styles: [] }), null)).toEqual({
      modus: 'blind',
      onlineView: null,
      kartenTheme: 'auto',
    });
  });

  it('bevorzugt die gemerkte Wahl (inkl. Karten-Theme), wenn gegen die Config gültig', () => {
    const gespeichert: GespeicherteBasemap = {
      modus: 'online',
      onlineView: 'basemap.de',
      kartenTheme: 'dark',
    };
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual(gespeichert);
  });

  it('behält den gemerkten Modus, ersetzt aber einen entfernten Online-View durch den ersten', () => {
    const gespeichert: GespeicherteBasemap = {
      modus: 'online',
      onlineView: 'Weg',
      kartenTheme: 'auto',
    };
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual({
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'auto',
    });
  });

  it('verwirft gemerktes offline, wenn offline nicht (mehr) verfügbar', () => {
    const gespeichert: GespeicherteBasemap = {
      modus: 'offline',
      onlineView: 'Liberty',
      kartenTheme: 'light',
    };
    // offline_verfuegbar=false → offline ungültig → Default online; Karten-Theme bleibt erhalten.
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual({
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'light',
    });
  });

  it('verwirft gemerktes online, wenn keine Online-Views (mehr) existieren', () => {
    const gespeichert: GespeicherteBasemap = {
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'auto',
    };
    const c = config({
      online_styles: [],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=x',
    });
    expect(waehleInitialeBasemap(c, gespeichert)).toEqual({
      modus: 'offline',
      onlineView: null,
      kartenTheme: 'auto',
    });
  });

  it('behält gemerktes blind und setzt den ersten Online-View als Switcher-Vorgabe', () => {
    expect(
      waehleInitialeBasemap(config(), { modus: 'blind', onlineView: null, kartenTheme: 'auto' }),
    ).toEqual({ modus: 'blind', onlineView: 'Liberty', kartenTheme: 'auto' });
  });

  it('nutzt den Einsatz-Default, wenn keine gemerkte Wahl existiert', () => {
    const c = config({
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=x',
    });
    expect(waehleInitialeBasemap(c, null, 'offline')).toEqual({
      modus: 'offline',
      onlineView: 'Liberty',
      kartenTheme: 'auto',
    });
  });

  it('ignoriert einen ungültigen Einsatz-Default und nimmt den Verfügbarkeits-Default', () => {
    // offline als Einsatz-Default, aber offline nicht verfügbar → online-Default.
    expect(waehleInitialeBasemap(config(), null, 'offline')).toEqual({
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'auto',
    });
  });

  it('gemerkte Wahl schlägt den Einsatz-Default', () => {
    const c = config({
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=x',
    });
    expect(
      waehleInitialeBasemap(
        c,
        { modus: 'blind', onlineView: null, kartenTheme: 'auto' },
        'offline',
      ),
    ).toEqual({ modus: 'blind', onlineView: 'Liberty', kartenTheme: 'auto' });
  });

  it('defaultet ein fehlendes/ungültiges gemerktes Karten-Theme auf auto', () => {
    // Alt-Eintrag ohne kartenTheme bzw. mit Müllwert.
    const gespeichert = {
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'sepia',
    } as unknown as GespeicherteBasemap;
    expect(waehleInitialeBasemap(config(), gespeichert)).toEqual({
      modus: 'online',
      onlineView: 'Liberty',
      kartenTheme: 'auto',
    });
  });
});
