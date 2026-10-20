import { describe, expect, it } from 'vitest';
import type { Betreuungsstelle } from '../api/types';
import {
  sichtbareVerbleibFelder,
  stellenOptionen,
  rettungsmittelOptionen,
  uebergabeBody,
  verbleibBody,
  zielNachArtwechsel,
  zielNachStellenwahl,
} from './verbleibErfassungKern';

function stelle(teil: Partial<Betreuungsstelle> & { id: number; bezeichnung: string }) {
  return {
    einsatz_id: 1,
    art: 'notunterkunft',
    status: 'in_betrieb',
    angelegt_at: '2026-09-24 08:00:00',
    ...teil,
  } as Betreuungsstelle;
}

const nord = stelle({ id: 7, bezeichnung: 'NU Turnhalle Nord' });
const sued = stelle({ id: 8, bezeichnung: 'NU Schule Süd' });

describe('sichtbareVerbleibFelder (design.md D6)', () => {
  it('Transport zeigt Ziel und Transportmittel, keine Stelle', () => {
    expect(sichtbareVerbleibFelder('transport', true)).toEqual({
      ziel: true,
      transportmittel: true,
      stelle: false,
    });
  });

  it('Notunterkunft zeigt die Stelle nur mit Betreuungszugriff', () => {
    expect(sichtbareVerbleibFelder('notunterkunft', true)).toEqual({
      ziel: true,
      transportmittel: false,
      stelle: true,
    });
    expect(sichtbareVerbleibFelder('notunterkunft', false).stelle).toBe(false);
  });

  it('übrige Arten zeigen nur das Ziel', () => {
    for (const art of ['entlassung', 'vor_ort', 'verstorben'] as const) {
      expect(sichtbareVerbleibFelder(art, true)).toEqual({
        ziel: true,
        transportmittel: false,
        stelle: false,
      });
    }
  });

  it('ohne gewählte Art gibt es weder Transportmittel noch Stelle', () => {
    expect(sichtbareVerbleibFelder(undefined, true)).toEqual({
      ziel: true,
      transportmittel: false,
      stelle: false,
    });
  });
});

describe('stellenOptionen', () => {
  it('lässt stornierte weg und markiert geschlossene, ohne sie zu sperren', () => {
    const optionen = stellenOptionen([
      nord,
      stelle({ id: 9, bezeichnung: 'NU Zu', status: 'geschlossen' }),
      stelle({ id: 10, bezeichnung: 'NU Weg', storniert_at: '2026-09-24 09:00:00' }),
    ]);
    expect(optionen).toEqual([
      { value: 7, label: 'NU Turnhalle Nord' },
      { value: 9, label: 'NU Zu · geschlossen' },
    ]);
    expect(optionen.every((o) => !('disabled' in o))).toBe(true);
  });
});

describe('zielNachStellenwahl (Vorbelegung, Entscheidung 24.09.2026)', () => {
  it('belegt ein leeres Ziel mit dem Namen der gewählten Stelle vor', () => {
    expect(zielNachStellenwahl({ ziel: undefined, vorher: undefined, neu: nord })).toBe(
      'NU Turnhalle Nord',
    );
    expect(zielNachStellenwahl({ ziel: '  ', vorher: undefined, neu: nord })).toBe(
      'NU Turnhalle Nord',
    );
  });

  it('ersetzt eine unveränderte Vorbelegung beim Stellenwechsel', () => {
    expect(zielNachStellenwahl({ ziel: 'NU Turnhalle Nord', vorher: nord, neu: sued })).toBe(
      'NU Schule Süd',
    );
  });

  it('überschreibt keinen eigenen Text der Person', () => {
    expect(zielNachStellenwahl({ ziel: 'Turnhalle Nord, Halle 2', vorher: nord, neu: sued })).toBe(
      'Turnhalle Nord, Halle 2',
    );
    expect(zielNachStellenwahl({ ziel: 'Eigener Text', vorher: undefined, neu: nord })).toBe(
      'Eigener Text',
    );
  });

  it('Leeren der Auswahl leert nur eine unveränderte Vorbelegung', () => {
    expect(zielNachStellenwahl({ ziel: 'NU Turnhalle Nord', vorher: nord, neu: undefined })).toBe(
      undefined,
    );
    expect(zielNachStellenwahl({ ziel: 'Eigener Text', vorher: nord, neu: undefined })).toBe(
      'Eigener Text',
    );
  });
});

describe('verbleibBody', () => {
  it('schickt die Stelle nur bei Notunterkunft mit', () => {
    expect(
      verbleibBody(
        { art: 'notunterkunft', betreuungsstelle_id: 7, ziel: 'NU Turnhalle Nord' },
        true,
      ),
    ).toEqual({
      art: 'notunterkunft',
      ziel: 'NU Turnhalle Nord',
      transportmittel: null,
      status: null,
      notiz: null,
      betreuungsstelle_id: 7,
    });
  });

  it('schickt die Bestätigung am Gerät nur, wenn gewählt (LFH-1046)', () => {
    expect(verbleibBody({ art: 'transport', bestaetigt_personal_id: 5 }, false)).toMatchObject({
      bestaetigt_personal_id: 5,
    });
    expect(verbleibBody({ art: 'transport' }, false)).not.toHaveProperty('bestaetigt_personal_id');
  });

  it('lässt eine liegengebliebene Stelle nach einem Artwechsel weg (sonst 422)', () => {
    const body = verbleibBody(
      { art: 'transport', betreuungsstelle_id: 7, ziel: 'KH Mitte' },
      false,
    );
    expect(body).not.toHaveProperty('betreuungsstelle_id');
    expect(body.status).toBe('abtransportiert');
  });

  it('lässt ein liegengebliebenes Transportmittel außerhalb des Transports weg', () => {
    expect(
      verbleibBody({ art: 'entlassung', transportmittel: 'RTW' }, false).transportmittel,
    ).toBeNull();
    expect(verbleibBody({ art: 'transport', transportmittel: 'RTW' }, false).transportmittel).toBe(
      'RTW',
    );
  });

  it('lässt den Verweis weg, wenn das Stellenfeld nicht (mehr) sichtbar ist (sonst 403)', () => {
    // Kippt der Betreuungszugriff mitten im Dialog, bleibt der Wert im Formularspeicher stehen.
    expect(
      verbleibBody({ art: 'notunterkunft', betreuungsstelle_id: 7 }, false),
    ).not.toHaveProperty('betreuungsstelle_id');
  });
});

describe('zielNachArtwechsel', () => {
  it('leert eine unveränderte Stellen-Vorbelegung beim Wechsel weg von der Notunterkunft', () => {
    expect(
      zielNachArtwechsel({ art: 'transport', ziel: 'NU Turnhalle Nord', gewaehlt: nord }),
    ).toBe(undefined);
  });

  it('lässt eigenen Text und die Notunterkunft selbst unberührt', () => {
    expect(zielNachArtwechsel({ art: 'transport', ziel: 'KH Mitte', gewaehlt: nord })).toBe(
      'KH Mitte',
    );
    expect(
      zielNachArtwechsel({ art: 'notunterkunft', ziel: 'NU Turnhalle Nord', gewaehlt: nord }),
    ).toBe('NU Turnhalle Nord');
    expect(zielNachArtwechsel({ art: 'transport', ziel: 'X', gewaehlt: undefined })).toBe('X');
  });
});

describe('Fahrer-Angabe (LLH-1332, Spec `patienten-uebergabe`)', () => {
  it('Transport mit Fahrzeug aus dem Einsatz ist ein Eigentransport', () => {
    expect(
      verbleibBody(
        { art: 'transport', transportmittel: '1/83-1', einsatz_fahrzeug_id: 9, ziel: 'KH' },
        false,
      ),
    ).toMatchObject({
      art: 'transport',
      transport_durch: 'eigen',
      einsatz_fahrzeug_id: 9,
      status: 'abtransportiert',
    });
  });

  it('Transport mit freiem Text ist ein fremdes Rettungsmittel', () => {
    const body = verbleibBody({ art: 'transport', transportmittel: 'RTW 3/83-2' }, false);
    expect(body).toMatchObject({ transport_durch: 'fremd', transportmittel: 'RTW 3/83-2' });
    expect(body).not.toHaveProperty('einsatz_fahrzeug_id');
  });

  it('andere Arten tragen keine Fahrer-Angabe, auch kein liegengebliebenes Fahrzeug', () => {
    const body = verbleibBody({ art: 'entlassung', einsatz_fahrzeug_id: 9 }, false);
    expect(body).not.toHaveProperty('transport_durch');
    expect(body).not.toHaveProperty('einsatz_fahrzeug_id');
  });

  it('rettungsmittelOptionen gruppiert „Im Einsatz“, „Bisher verwendet“, „Fahrzeugstamm“', () => {
    const gruppen = rettungsmittelOptionen({
      im_einsatz: [{ einsatz_fahrzeug_id: 9, funkrufname: '1/83-1', fahrzeugtyp: 'RTW' }],
      bisher: ['RTW 3/83-2'],
      stamm: [],
    });
    expect(gruppen.map((g) => g.label)).toEqual(['Im Einsatz', 'Bisher verwendet']);
    expect(gruppen[0].options[0]).toMatchObject({ value: '1/83-1', einsatzFahrzeugId: 9 });
    expect(gruppen[1].options[0]).toMatchObject({ value: 'RTW 3/83-2' });
    expect(gruppen[1].options[0]).not.toHaveProperty('einsatzFahrzeugId');
  });

  it('uebergabeBody quittiert die Übergabe mit Fahrzeug, Ziel und Erfassungszeit', () => {
    expect(
      uebergabeBody(
        { aktuelles_einsatz_fahrzeug_id: 9, aktuelles_verbleib_ziel: 'KH Mitte' },
        { ziel: 'KH Nord', zeitpunkt_at: '2026-10-19 10:42:00' },
      ),
    ).toEqual({
      art: 'transport',
      transport_durch: 'eigen',
      einsatz_fahrzeug_id: 9,
      status: 'uebergeben',
      ziel: 'KH Nord',
      zeitpunkt_at: '2026-10-19 10:42:00',
    });
    expect(
      uebergabeBody({ aktuelles_einsatz_fahrzeug_id: 9, aktuelles_verbleib_ziel: 'KH Mitte' }, {}),
    ).toMatchObject({ ziel: 'KH Mitte' });
  });
});
