import { beforeEach, describe, expect, it } from 'vitest';
import type { GeraetAnzeige } from '../api/types';
import { rohLesen } from '../test/rohIdb';
import {
  discardFruehereKopplung,
  countFruehereKopplung,
  loadGeraetKonten,
  confirmGeraetKonto,
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
    await confirmGeraetKonto(ALT, geraet());
    await confirmGeraetKonto(NEU, geraet({ stelle_id: 5 }));
    await confirmGeraetKonto(NEU, geraet({ stelle_id: 5 }));
    // ALT hat keine Zeilen mehr und fällt weg; das aktuelle Konto bleibt immer.
    expect(loadGeraetKonten()).toEqual([
      { benutzer_id: NEU, einsatz_id: 7, ansicht: 'uhs-tablet', stelle_id: 5 },
    ]);
  });

  it('übernimmt bei gleicher Stelle Ausstehendes und Abgelehntes mit Schlüssel und Erfassungszeit', async () => {
    await confirmGeraetKonto(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));
    await schreibaktionEinreihen(ALT, 7, sichtung('s-2'));
    await schreibaktionEinreihen(ALT, 7, sichtung('s-3'));
    const [, zweite] = await schreibaktionenLaden(ALT, 7);
    await schreibaktionAblehnen(ALT, zweite, 'Person nicht in dieser UHS');
    await queueEinreihen(ALT, 7, { typ: 'meldung', inhalt: 'x', client_id: 'etb-1' });

    await confirmGeraetKonto(NEU, geraet({ kopplung_id: 4, bezeichnung: 'Tablet 1 neu' }));

    expect(await queueZaehlerLaden(ALT, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 });
    expect(await queueZaehlerLaden(NEU, 7)).toMatchObject({ ausstehend: 3, abgelehnt: 1 });
    const offen = await schreibaktionenLaden(NEU, 7);
    expect(offen.map((z) => z.aktion)).toEqual([sichtung('s-1'), sichtung('s-3')]);
    expect((await schreibaktionenAbgelehntLaden(NEU, 7))[0].grund).toBe(
      'Person nicht in dieser UHS',
    );
    expect(loadGeraetKonten().map((k) => k.benutzer_id)).toEqual([NEU]);
  });

  it.each([
    ['andere Stelle', { stelle_id: 5 }],
    ['anderer Einsatz', { einsatz_id: 8 }],
    ['andere Ansicht', { ansicht: 'uhs-laptop' as const }],
  ])('übernimmt bei %s nichts und zählt die Einträge als frühere Kopplung', async (_, teil) => {
    await confirmGeraetKonto(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));

    await confirmGeraetKonto(NEU, geraet(teil));

    expect(await queueZaehlerLaden(NEU)).toMatchObject({ ausstehend: 0 });
    expect(await countFruehereKopplung(NEU)).toBe(1);
    expect(loadGeraetKonten().map((k) => k.benutzer_id)).toEqual([NEU, ALT]);
  });

  it('übernimmt nie Zeilen einer Person, die vorher an diesem Browser angemeldet war', async () => {
    await schreibaktionEinreihen(PERSON, 7, sichtung('person-1'));
    await confirmGeraetKonto(NEU, geraet());

    expect(await queueZaehlerLaden(PERSON, 7)).toMatchObject({ ausstehend: 1 });
    expect(await queueZaehlerLaden(NEU, 7)).toMatchObject({ ausstehend: 0 });
    expect(await countFruehereKopplung(NEU)).toBe(0);
    expect(await countFruehereKopplung(null)).toBe(0);
  });

  it('ohne Sitzung zählt jede gemerkte Kopplung, auch die gerade beendete', async () => {
    await confirmGeraetKonto(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));
    await queueEinreihen(ALT, 7, { typ: 'meldung', inhalt: 'x' });
    expect(await countFruehereKopplung(null)).toBe(2);
  });

  it('verwirft nur Zeilen früherer Gerätekonten und vergisst sie', async () => {
    await confirmGeraetKonto(ALT, geraet());
    await schreibaktionEinreihen(ALT, 7, sichtung('s-1'));
    await schreibaktionEinreihen(PERSON, 7, sichtung('person-1'));
    await confirmGeraetKonto(NEU, geraet({ stelle_id: 5 }));
    await schreibaktionEinreihen(NEU, 7, sichtung('neu-1'));

    expect(await discardFruehereKopplung(NEU)).toBe(1);

    const platte = (await rohLesen('lifeline-offline', 'schreibaktionen')) as {
      benutzer_id: number;
    }[];
    expect(platte.map((z) => z.benutzer_id).sort()).toEqual([PERSON, NEU].sort());
    expect(loadGeraetKonten().map((k) => k.benutzer_id)).toEqual([NEU]);
  });

  it('übersteht einen unlesbaren Speicherstand', async () => {
    localStorage.setItem('lifeline-hub.geraet-konten', '{kaputt');
    expect(loadGeraetKonten()).toEqual([]);
    await confirmGeraetKonto(NEU, geraet());
    expect(loadGeraetKonten().map((k) => k.benutzer_id)).toEqual([NEU]);
  });

  it('behält jedes Konto mit Zeilen, auch über zehn Kopplungen hinaus', async () => {
    await confirmGeraetKonto(100, geraet({ stelle_id: 100 }));
    await schreibaktionEinreihen(100, 7, sichtung('aeltestes'));
    for (let id = 101; id <= 112; id++) {
      await confirmGeraetKonto(id, geraet({ stelle_id: id }));
      await schreibaktionEinreihen(id, 7, sichtung(`k-${id}`));
    }
    await confirmGeraetKonto(NEU, geraet({ stelle_id: 999 }));
    expect(await countFruehereKopplung(NEU)).toBe(13);
    expect(loadGeraetKonten().map((k) => k.benutzer_id)).toContain(100);
  });
});
