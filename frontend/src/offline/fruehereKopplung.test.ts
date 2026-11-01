import { beforeEach, describe, expect, it } from 'vitest';
import type { GeraetAnzeige } from '../api/types';
import { rohLesen } from '../test/rohIdb';
import {
  fruehereKopplungVerwerfen,
  fruehereKopplungZaehlen,
  geraetKontenLesen,
  geraetKontoBestaetigt,
} from './fruehereKopplung';
import {
  queueEinreihen,
  queueLeerenFuerTests,
  queueZaehlerLaden,
  schreibaktionAblehnen,
  schreibaktionEinreihen,
  schreibaktionenAbgelehntLaden,
  schreibaktionenLaden,
  type OfflineSchreibaktion,
} from './queue';

const ALT = 41;
const NEU = 42;
const PERSON = 7;

function geraet(teil: Partial<GeraetAnzeige> = {}): GeraetAnzeige {
  return {
    kopplung_id: 3,
    einsatz_id: 7,
    ansicht: 'uhs-tablet',
    stelle_id: 2,
    uhs_id: 2,
    stelle: 'UHS Nord',
    bezeichnung: 'Tablet 1',
    laeuft_ab_at: '2026-11-01 18:00:00',
    ...teil,
  };
}

const sichtung = (cid: string): OfflineSchreibaktion => ({
  art: 'sichtung',
  person_id: 10,
  bezeichnung: 'R-012',
  daten: { kategorie: 'sk1', notiz: null, client_id: cid, zeitpunkt_at: '2026-11-01 14:10:00' },
});

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('Vorgemerktes früherer Kopplungen (LLH-1331)', () => {
  it('merkt sich das Gerätekonto, neueste zuerst, ohne Doppel', async () => {
    await geraetKontoBestaetigt(ALT, geraet());
    await geraetKontoBestaetigt(NEU, geraet({ stelle_id: 5 }));
    await geraetKontoBestaetigt(NEU, geraet({ stelle_id: 5 }));
    // ALT hat keine Zeilen mehr und fällt weg; das aktuelle Konto bleibt immer.
    expect(geraetKontenLesen()).toEqual([
      { benutzer_id: NEU, einsatz_id: 7, ansicht: 'uhs-tablet', stelle_id: 5 },
    ]);
  });

  it('übernimmt bei gleicher Stelle Ausstehendes und Abgelehntes mit Schlüssel und Erfassungszeit', async () => {
    await geraetKontoBestaetigt(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));
    await schreibaktionEinreihen(ALT, 7, sichtung('s-2'));
    await schreibaktionEinreihen(ALT, 7, sichtung('s-3'));
    const [, zweite] = await schreibaktionenLaden(ALT, 7);
    await schreibaktionAblehnen(ALT, zweite, 'Person nicht in dieser UHS');
    await queueEinreihen(ALT, 7, { typ: 'meldung', inhalt: 'x', client_id: 'etb-1' });

    await geraetKontoBestaetigt(NEU, geraet({ kopplung_id: 4, bezeichnung: 'Tablet 1 neu' }));

    expect(await queueZaehlerLaden(ALT, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 });
    expect(await queueZaehlerLaden(NEU, 7)).toMatchObject({ ausstehend: 3, abgelehnt: 1 });
    const offen = await schreibaktionenLaden(NEU, 7);
    expect(offen.map((z) => z.aktion)).toEqual([sichtung('s-1'), sichtung('s-3')]);
    expect((await schreibaktionenAbgelehntLaden(NEU, 7))[0].grund).toBe(
      'Person nicht in dieser UHS',
    );
    expect(geraetKontenLesen().map((k) => k.benutzer_id)).toEqual([NEU]);
  });

  it.each([
    ['andere Stelle', { stelle_id: 5 }],
    ['anderer Einsatz', { einsatz_id: 8 }],
    ['andere Ansicht', { ansicht: 'uhs-laptop' as const }],
  ])('übernimmt bei %s nichts und zählt die Einträge als frühere Kopplung', async (_, teil) => {
    await geraetKontoBestaetigt(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));

    await geraetKontoBestaetigt(NEU, geraet(teil));

    expect(await queueZaehlerLaden(NEU)).toMatchObject({ ausstehend: 0 });
    expect(await fruehereKopplungZaehlen(NEU)).toBe(1);
    expect(geraetKontenLesen().map((k) => k.benutzer_id)).toEqual([NEU, ALT]);
  });

  it('übernimmt nie Zeilen einer Person, die vorher an diesem Browser angemeldet war', async () => {
    await schreibaktionEinreihen(PERSON, 7, sichtung('person-1'));
    await geraetKontoBestaetigt(NEU, geraet());

    expect(await queueZaehlerLaden(PERSON, 7)).toMatchObject({ ausstehend: 1 });
    expect(await queueZaehlerLaden(NEU, 7)).toMatchObject({ ausstehend: 0 });
    expect(await fruehereKopplungZaehlen(NEU)).toBe(0);
    expect(await fruehereKopplungZaehlen(null)).toBe(0);
  });

  it('ohne Sitzung zählt jede gemerkte Kopplung, auch die gerade beendete', async () => {
    await geraetKontoBestaetigt(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));
    await queueEinreihen(ALT, 7, { typ: 'meldung', inhalt: 'x' });
    expect(await fruehereKopplungZaehlen(null)).toBe(2);
  });

  it('verwirft nur Zeilen früherer Gerätekonten und vergisst sie', async () => {
    await geraetKontoBestaetigt(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));
    await schreibaktionEinreihen(PERSON, 7, sichtung('person-1'));
    await geraetKontoBestaetigt(NEU, geraet({ stelle_id: 5 }));
    await schreibaktionEinreihen(NEU, 7, sichtung('neu-1'));

    expect(await fruehereKopplungVerwerfen(NEU)).toBe(1);

    const platte = (await rohLesen('lifeline-offline', 'schreibaktionen')) as {
      benutzer_id: number;
    }[];
    expect(platte.map((z) => z.benutzer_id).sort()).toEqual([PERSON, NEU].sort());
    expect(geraetKontenLesen().map((k) => k.benutzer_id)).toEqual([NEU]);
  });

  it('übersteht einen unlesbaren Speicherstand', async () => {
    localStorage.setItem('lifeline-hub.geraet-konten', '{kaputt');
    expect(geraetKontenLesen()).toEqual([]);
    await geraetKontoBestaetigt(NEU, geraet());
    expect(geraetKontenLesen().map((k) => k.benutzer_id)).toEqual([NEU]);
  });
});
