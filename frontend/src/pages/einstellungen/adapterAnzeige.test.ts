import { describe, expect, it } from 'vitest';
import type { AdapterFeld } from '../../api/types';
import { adapterFehlerText, adapterVersuchText } from '../../api/adapter';
import {
  adapterPath,
  adapterZustandAnzeige,
  einstellungenVon,
  hostWechsel,
  isZustandSichtbar,
} from './adapterAnzeige';

/** Anzeige-Hilfen der Adapter (LLH-2018). */

const felder: AdapterFeld[] = [
  { name: 'url', bezeichnung: 'Adresse', typ: 'url', pflicht: true, max: 512 },
  { name: 'standort', bezeichnung: 'Standort-Kennung', typ: 'text', pflicht: false, max: 40 },
  { name: 'seite', bezeichnung: 'Seitengröße', typ: 'zahl', pflicht: false, max: 0 },
];

describe('adapterZustandAnzeige', () => {
  it('gibt jedem Zustand Wort und Ton', () => {
    expect(adapterZustandAnzeige({ zustand: 'ok' })).toEqual({ wort: 'ok', ton: 'normal' });
    expect(adapterZustandAnzeige({ zustand: 'wartet' })).toEqual({
      wort: 'noch nie abgerufen',
      ton: 'neutral',
    });
    expect(adapterZustandAnzeige({ zustand: 'gestoert' })).toEqual({
      wort: 'gestört',
      ton: 'bedien',
    });
    expect(adapterZustandAnzeige({ zustand: 'braucht_eingriff' })).toEqual({
      wort: 'braucht Eingriff',
      ton: 'achtung',
    });
    expect(adapterZustandAnzeige({ zustand: 'aus' })).toEqual({ wort: 'aus', ton: 'neutral' });
    expect(adapterZustandAnzeige({ zustand: 'art_unbekannt' })).toEqual({
      wort: 'Art unbekannt',
      ton: 'achtung',
    });
  });
});

describe('isZustandSichtbar', () => {
  it('zeigt den Status in der Liste nur, wenn er etwas verlangt', () => {
    expect(isZustandSichtbar('gestoert')).toBe(true);
    expect(isZustandSichtbar('braucht_eingriff')).toBe(true);
    expect(isZustandSichtbar('aus')).toBe(true);
    expect(isZustandSichtbar('art_unbekannt')).toBe(true);
    expect(isZustandSichtbar('ok')).toBe(false);
    expect(isZustandSichtbar('wartet')).toBe(false);
  });
});

describe('adapterPath', () => {
  it('liegt unter den Anbindungen und maskiert die Kennung', () => {
    expect(adapterPath('a b')).toBe('/admin/einstellungen/anbindungen/adapter/a%20b');
  });
});

describe('hostWechsel', () => {
  it('meldet nichts bei gleichem Host, auch mit anderem Pfad oder anderer Schreibung', () => {
    expect(
      hostWechsel(
        felder,
        { url: 'https://alarm.example/api' },
        { url: 'https://ALARM.example/v2' },
      ),
    ).toEqual([]);
  });

  it('meldet einen anderen Host mit altem und neuem Namen', () => {
    expect(
      hostWechsel(
        felder,
        { url: 'https://alarm.example/api' },
        { url: 'https://alarm2.example/api' },
      ),
    ).toEqual([{ feld: 'Adresse', bisher: 'alarm.example', neu: 'alarm2.example' }]);
  });

  it('meldet auch die erste Adresse', () => {
    expect(hostWechsel(felder, {}, { url: 'https://alarm.example' })).toEqual([
      { feld: 'Adresse', bisher: null, neu: 'alarm.example' },
    ]);
  });

  it('übergeht eine unlesbare oder geleerte Adresse und Felder ohne URL', () => {
    expect(hostWechsel(felder, { url: 'https://a.example' }, { url: 'kein url' })).toEqual([]);
    expect(hostWechsel(felder, { url: 'https://a.example' }, { url: '' })).toEqual([]);
    expect(hostWechsel(felder, { standort: 'A' }, { standort: 'B' })).toEqual([]);
  });
});

describe('einstellungenVon', () => {
  it('trimmt Text, nimmt Zahlen als Zahl und lässt Leeres weg', () => {
    expect(
      einstellungenVon(felder, { url: ' https://a.example ', standort: '  ', seite: '25' }),
    ).toEqual({
      url: 'https://a.example',
      seite: 25,
    });
    expect(einstellungenVon(felder, { seite: null })).toEqual({});
  });
});

describe('adapterFehlerText', () => {
  it('nennt den Fehler im Klartext, mit Status, wenn das Ziel antwortete', () => {
    expect(adapterFehlerText('abgelehnt', 401)).toBe('Zugang abgelehnt (401)');
    expect(adapterFehlerText('zeitueberschreitung')).toBe('Keine Antwort in 20 s');
    expect(adapterFehlerText('geheimnis_fehlt')).toBe('Geheimnis fehlt');
  });

  it('beschreibt einen Versuch in einer Zeile', () => {
    expect(adapterVersuchText({ erfolg: true, status: 200, anzahl: 4, probe: false })).toBe(
      'abgerufen (200) · 4 Einträge',
    );
    expect(adapterVersuchText({ erfolg: true, status: 200, anzahl: 1, probe: true })).toBe(
      'erreichbar (200) · 1 Eintrag · Prüfung',
    );
    expect(adapterVersuchText({ erfolg: false, fehler_art: 'verbindung', probe: false })).toBe(
      'Keine Verbindung zum Ziel',
    );
  });
});
