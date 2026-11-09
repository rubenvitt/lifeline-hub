import { describe, expect, it } from 'vitest';
import type { InstanzKopplungAnzeige, InstanzUebersicht } from '../api/types';
import {
  codeAusstellenSperre,
  kopplungHinweise,
  kopplungZustandZeile,
  richtungText,
  stammdatenZeile,
} from './instanzText';

const kopplung = (teil: Partial<InstanzKopplungAnzeige> = {}): InstanzKopplungAnzeige => ({
  id: 1,
  gegenueber_name: 'Hub DRK',
  gegenueber_kennung: 'k',
  gegenueber_fingerabdruck: 'ABCD-EFGH',
  richtung: 'meldet_sich',
  gegenueber_adresse: 'https://hub.example.org',
  zustand: 'aktiv',
  protokoll: 'passt',
  zuletzt_gesehen_at: '2026-11-08 12:00:00',
  gegenueber_softwarestand: '1.2.0',
  org: {
    id: 1,
    fremde_org_name: 'DRK KV Nord',
    fremde_org_kennung: 'k/1',
    angelegt_at: '2026-11-08 11:00:00',
    stammdaten: { stand: 0, hinweise: [], geheimnisse_verteilt: true, konten_mit_geheimnis: 0 },
  },
  ...teil,
});

const zeit = (w: string) => `[${w}]`;

describe('instanzText', () => {
  it('Zustandszeile nennt Zustand, zuletzt gesehen, Stand und Org', () => {
    expect(kopplungZustandZeile(kopplung(), zeit)).toBe(
      'aktiv · zuletzt gesehen [2026-11-08 12:00:00] · Stand 1.2.0 · Org dort: DRK KV Nord',
    );
    expect(
      kopplungZustandZeile(
        kopplung({
          zustand: 'angebahnt',
          zuletzt_gesehen_at: undefined,
          gegenueber_softwarestand: undefined,
        }),
        zeit,
      ),
    ).toBe('wartet auf erste Meldung · noch nie gesehen · Org dort: DRK KV Nord');
  });

  it('Richtung ohne Hub und ELW', () => {
    expect(richtungText(kopplung())).toBe('diese Instanz meldet sich dort');
    expect(richtungText(kopplung({ richtung: 'wird_gemeldet' }))).toBe('meldet sich hier');
  });

  it('Hinweise: Update, Uhr, Fehler, bleibender Hinweis', () => {
    expect(kopplungHinweise(kopplung())).toEqual([]);
    expect(kopplungHinweise(kopplung({ uhr_abweichung_s: 119 }))).toEqual([]);
    expect(
      kopplungHinweise(
        kopplung({
          protokoll: 'update_gegenueber',
          uhr_abweichung_s: -400,
          letzter_fehler: 'nicht erreichbar: Zeitüberschreitung',
          hinweis: 'Unterschriftsschlüssel von X abgelehnt',
        }),
      ),
    ).toEqual([
      'Update nötig: das Gegenüber ist zu alt',
      'Uhr weicht um 400 s ab',
      'Letzte Meldung: nicht erreichbar: Zeitüberschreitung',
      'Unterschriftsschlüssel von X abgelehnt',
    ]);
    expect(kopplungHinweise(kopplung({ protokoll: 'update_hier' }))).toEqual([
      'Update nötig: diese Instanz ist zu alt',
    ]);
  });

  it('Widerruf, der noch nicht zugestellt ist, steht als Hinweis', () => {
    const offen = kopplung({
      zustand: 'widerrufen',
      letzter_fehler: 'nicht erreichbar: Zeitüberschreitung',
    });
    expect(kopplungHinweise(offen)).toEqual([
      'Widerruf noch nicht beim Gegenüber, wird nachgereicht',
      'Letzte Meldung: nicht erreichbar: Zeitüberschreitung',
    ]);
    expect(kopplungHinweise(kopplung({ zustand: 'widerrufen' }))).toEqual([]);
    expect(
      kopplungHinweise(
        kopplung({ zustand: 'widerrufen', richtung: 'wird_gemeldet', letzter_fehler: 'x' }),
      ),
    ).toEqual(['Letzte Meldung: x']);
  });

  it('Stammdaten: Hinweise aus der Übernahme und fehlende Plattenbestätigung (LLH-1493)', () => {
    const org = (teil: Partial<InstanzKopplungAnzeige['org']['stammdaten']>) => ({
      ...kopplung().org,
      stammdaten: { ...kopplung().org.stammdaten, ...teil },
    });
    expect(
      kopplungHinweise(
        kopplung({ org: org({ hinweise: ['Konto „admin“ ist hier schon vergeben.'] }) }),
      ),
    ).toEqual(['Konto „admin“ ist hier schon vergeben.']);
    expect(kopplungHinweise(kopplung(), false)).toEqual([
      'Geheimnisse nicht verteilt: Datenträgerverschlüsselung nicht bestätigt',
    ]);
    expect(
      kopplungHinweise(
        kopplung({ richtung: 'wird_gemeldet', org: org({ geheimnisse_verteilt: false }) }),
      ),
    ).toEqual([
      'Kontogeheimnisse gehen nicht hinaus: Datenträgerverschlüsselung dort nicht bestätigt',
    ]);
    expect(stammdatenZeile(kopplung({ org: org({ stand: 42 }) }))).toBe(
      'Stammdaten übernommen bis Stand 42',
    );
    expect(stammdatenZeile(kopplung())).toBeNull();
    expect(
      stammdatenZeile(
        kopplung({ richtung: 'wird_gemeldet', org: org({ konten_mit_geheimnis: 3 }) }),
      ),
    ).toBe('Kontogeheimnisse dort: 3 Konten');
  });

  it('Code ausstellen ist ohne Passkeys oder eigenen Schlüssel gesperrt', () => {
    const u = (teil: Partial<InstanzUebersicht>): InstanzUebersicht => ({
      name: 'ELW',
      kennung: 'k',
      fingerabdruck: 'F',
      protokoll: 1,
      softwarestand: '1',
      passkeys_eingerichtet: true,
      eigener_schluessel: true,
      datentraeger_bestaetigt: true,
      kopplungen: [],
      schluessel: [],
      ...teil,
    });
    expect(codeAusstellenSperre(u({}))).toBeUndefined();
    expect(codeAusstellenSperre(u({ eigener_schluessel: false }))).toBe(
      'Erst einen eigenen Unterschriftsschlüssel registrieren',
    );
    expect(codeAusstellenSperre(u({ passkeys_eingerichtet: false }))).toBe(
      'Passkeys sind an dieser Instanz nicht eingerichtet',
    );
  });
});
