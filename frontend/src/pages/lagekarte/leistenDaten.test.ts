import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt, EinsatzFahrzeug, Schaden, Uhs } from '../../api/types';
import { farbenDunkel } from '../../theme/tokens';
import type { KarteMarker } from './marker';
import type { LayerSichtbar } from './Sidebar';
import {
  EBENEN,
  LEERE_ROHDATEN,
  auswahlRaster,
  auswahlUnterzeile,
  ebenenFarbe,
  ebenenZeilen,
  grundlageAufloesen,
  grundlageOptionen,
  grundlageWert,
  staerkeText,
  verortetAnzahl,
  type AuswahlRoh,
} from './leistenDaten';

const ALLE_AN: LayerSichtbar = {
  einsatzort: true,
  uhs: true,
  schaden: true,
  einheit: true,
  fahrzeug: true,
  fuehrung: true,
  abschnitt: true,
  zone: true,
  lagemeldung: true,
  freies_zeichen: true,
};

const marker = (typ: KarteMarker['typ'], id = 1, label = 'X'): KarteMarker => ({
  schluessel: `${typ}-${id}`,
  typ,
  id,
  lat: 50,
  lon: 8,
  label,
  farbe: farbenDunkel.bedien,
});

describe('ebenenZeilen', () => {
  it('führt dieselben zehn Schalter wie die Ebenen der Karte, jeden genau einmal', () => {
    const keys = EBENEN.map((e) => e.key).sort();
    expect(keys).toEqual((Object.keys(ALLE_AN) as (keyof LayerSichtbar)[]).sort());
  });

  it('zählt je Ebene die verorteten Marker ihres Typs', () => {
    const zeilen = ebenenZeilen(
      [marker('einheit', 1), marker('einheit', 2), marker('uhs', 3), marker('abschnitt', 4)],
      0,
      ALLE_AN,
      false,
    );
    const anzahl = Object.fromEntries(zeilen.map((z) => [z.key, z.anzahl]));
    expect(anzahl.einheit).toBe(2);
    expect(anzahl.uhs).toBe(1);
    expect(anzahl.abschnitt).toBe(1);
    expect(anzahl.fahrzeug).toBe(0);
  });

  it('zählt Zonen aus der ungegatterten Liste — auch bei abgeschalteter Ebene', () => {
    // `zonenFeatures` wäre bei `layer.zone = false` leer; die Zeile zeigte dann „0" für
    // Zonen, die es gibt. Deshalb kommt die Zahl von außen, nicht aus den Markern.
    const zeilen = ebenenZeilen([], 3, { ...ALLE_AN, zone: false }, false);
    const zone = zeilen.find((z) => z.key === 'zone')!;
    expect(zone.anzahl).toBe(3);
    expect(zone.sichtbar).toBe(false);
  });

  it('zeigt im Fehlerfall „—" statt einer Null, die niemand geprüft hat', () => {
    const zeilen = ebenenZeilen([marker('uhs')], 2, ALLE_AN, true);
    expect(zeilen.every((z) => z.anzahl === '—')).toBe(true);
  });

  it('trägt den Schaltzustand je Ebene', () => {
    const zeilen = ebenenZeilen([], 0, { ...ALLE_AN, schaden: false }, false);
    expect(zeilen.find((z) => z.key === 'schaden')!.sichtbar).toBe(false);
    expect(zeilen.find((z) => z.key === 'uhs')!.sichtbar).toBe(true);
  });
});

describe('ebenenFarbe', () => {
  it('nimmt die Rollen der Karte, wo die Karte eine Rolle zeichnet', () => {
    expect(ebenenFarbe('einsatzort', farbenDunkel)).toBe(farbenDunkel.marke);
    expect(ebenenFarbe('uhs', farbenDunkel)).toBe(farbenDunkel.bedien);
    expect(ebenenFarbe('zone', farbenDunkel)).toBe(farbenDunkel.alarm);
  });
});

describe('verortetAnzahl', () => {
  it('zählt Objekte, nicht den Einsatzort-Anker', () => {
    expect(verortetAnzahl([marker('einsatzort', 0), marker('uhs'), marker('einheit')])).toBe(2);
  });
});

const EINHEIT = {
  id: 1,
  name: 'Zug 1',
  typ_label: 'Zug',
  ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 9 },
  abschnitt_id: 4,
  abschnitt_name: 'Nord',
  fuehrer_name: 'Meier',
} as unknown as Einheit;

const FAHRZEUG = {
  id: 7,
  funkrufname: 'Florian 1',
  fahrzeugtyp: 'HLF 20',
  status_label: 'am Einsatzort',
  status_kategorie: 'gebunden',
  disponiert_at: '2026-09-21 09:12:00',
  einheit_id: 1,
  kennzeichen: null,
} as unknown as EinsatzFahrzeug;

const ROH: AuswahlRoh = {
  ...LEERE_ROHDATEN,
  einheiten: [EINHEIT],
  fahrzeuge: [FAHRZEUG],
  uhs: [{ id: 3, typ: 'bhp', status: 'aktiv', abschnitt_id: 4 } as unknown as Uhs],
  schaeden: [{ id: 9, status: 'offen', ausmass: 'gross' } as unknown as Schaden],
  abschnitte: [{ id: 4, name: 'Nord', leiter_name: 'Schulz' } as unknown as Einsatzabschnitt],
};

const zeit = (s: string | null | undefined) => `Z(${s})`;

describe('auswahlRaster', () => {
  it('Einheit: Stärke in BOS-Schreibweise, Abschnitt, Führer', () => {
    const raster = auswahlRaster(marker('einheit', 1), ROH, zeit);
    expect(raster.map((f) => [f.label, f.wert])).toEqual([
      ['Stärke', '1/2/9//12'],
      ['Abschnitt', 'Nord'],
      ['Führer', 'Meier'],
    ]);
  });

  it('Einheit: KEIN Status und KEIN „Seit" — das DTO hat beides nicht (LFH-609)', () => {
    const labels = auswahlRaster(marker('einheit', 1), ROH, zeit).map((f) => f.label);
    expect(labels).not.toContain('Status');
    expect(labels).not.toContain('Seit');
  });

  it('Fahrzeug: Status mit Rolle aus der Statuskategorie, Disponiert-Zeit, Einheit', () => {
    const raster = auswahlRaster(marker('fahrzeug', 7), ROH, zeit);
    expect(raster[0]).toMatchObject({ label: 'Status', wert: 'am Einsatzort', rolle: 'achtung' });
    expect(raster[1]).toEqual({ label: 'Disponiert', wert: 'Z(2026-09-21 09:12:00)' });
    expect(raster[2]).toMatchObject({ label: 'Einheit', wert: 'Zug 1' });
    // „Seit" hätte einen Zeitpunkt des Statuswechsels gebraucht — den führt das DTO nicht.
    expect(raster.map((f) => f.label)).not.toContain('Seit');
  });

  it('UHS: Abschnittsname über die Abschnittsliste', () => {
    const raster = auswahlRaster(marker('uhs', 3), ROH, zeit);
    expect(raster.find((f) => f.label === 'Abschnitt')?.wert).toBe('Nord');
  });

  it('Abschnitt: Leiter und Zahl der zugeordneten Einheiten', () => {
    const raster = auswahlRaster(marker('abschnitt', 4), ROH, zeit);
    expect(raster.map((f) => [f.label, f.wert])).toEqual([
      ['Leiter', 'Schulz'],
      ['Einheiten', '1'],
    ]);
  });

  it('ohne Rohdatensatz kein Raster — nichts wird erfunden', () => {
    expect(auswahlRaster(marker('einheit', 99), ROH, zeit)).toEqual([]);
    expect(auswahlRaster(marker('einsatzort', 0), ROH, zeit)).toEqual([]);
  });

  it('zeigt „—" für leere Angaben statt eines leeren Feldes', () => {
    const ohne = { ...EINHEIT, abschnitt_name: null, fuehrer_name: '  ' } as unknown as Einheit;
    const raster = auswahlRaster(marker('einheit', 1), { ...ROH, einheiten: [ohne] }, zeit);
    expect(raster.find((f) => f.label === 'Abschnitt')?.wert).toBe('—');
    expect(raster.find((f) => f.label === 'Führer')?.wert).toBe('—');
  });
});

describe('auswahlUnterzeile', () => {
  it('Objektart plus Typ, wo die Daten ihn tragen', () => {
    expect(auswahlUnterzeile(marker('einheit', 1), ROH)).toBe('Einheit · Zug');
    expect(auswahlUnterzeile(marker('fahrzeug', 7), ROH)).toBe('Fahrzeug · HLF 20');
    expect(auswahlUnterzeile(marker('fuehrung', 5), ROH)).toBe('Personal');
  });
});

describe('staerkeText', () => {
  it('schreibt F/UF/M//Σ und „—" ohne Angabe', () => {
    expect(staerkeText({ fuehrer: 0, unterfuehrer: 1, mannschaft: 3 })).toBe('0/1/3//4');
    expect(staerkeText(null)).toBe('—');
  });
});

describe('Kartengrundlage', () => {
  const STILE = [
    { name: 'Liberty', url: 'x', typ: 'vektor', attribution: null },
    { name: 'TopPlus', url: 'y', typ: 'raster', attribution: null },
  ] as never[];

  it('ein Segment je Online-Stil, dazu Offline und Blind — kein „Satellit" (LFH-616)', () => {
    const optionen = grundlageOptionen(STILE, true);
    expect(optionen.map((o) => o.label)).toEqual(['Liberty', 'TopPlus', 'Offline', 'Blind']);
    expect(optionen.every((o) => o.gesperrt == null)).toBe(true);
  });

  it('sperrt, was nicht konfiguriert ist, statt es wegzulassen', () => {
    const optionen = grundlageOptionen([], false);
    expect(optionen.map((o) => [o.label, o.gesperrt != null])).toEqual([
      ['Online', true],
      ['Offline', true],
      ['Blind', false],
    ]);
  });

  it('bildet Modus und Stil hin und zurück ab', () => {
    expect(grundlageWert('online', 'TopPlus', STILE)).toBe('online:TopPlus');
    expect(grundlageWert('online', null, STILE)).toBe('online:Liberty');
    expect(grundlageWert('offline', 'TopPlus', STILE)).toBe('offline');
    expect(grundlageAufloesen('online:TopPlus')).toEqual({
      basemap: 'online',
      stilName: 'TopPlus',
    });
    expect(grundlageAufloesen('blind')).toEqual({ basemap: 'blind', stilName: null });
    expect(grundlageAufloesen('offline')).toEqual({ basemap: 'offline', stilName: null });
  });
});
