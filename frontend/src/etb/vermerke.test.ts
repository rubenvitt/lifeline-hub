import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import { vermerkeTitel, vermerkeVon } from './vermerke';

const KONV = { zeitzone: 'Europe/Berlin', zeitdarstellung: 'taktisch' as const };

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'Lage erkundet',
    von: 'ELW',
    an: 'Leitstelle',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    berichtigt_durch: [],
    einheiten: [],
    anhaenge: [],
    ...over,
  };
}

const kontext = (over: Partial<Parameters<typeof vermerkeVon>[1]> = {}) => ({
  einsatzId: 7,
  grundeintrag: null,
  konventionen: KONV,
  ...over,
});

describe('vermerkeVon — Verweise und Marken eines Eintrags', () => {
  it('ein schlichter Eintrag hat keinen Vermerk', () => {
    expect(vermerkeVon(eintrag(), kontext())).toEqual([]);
  });

  it('Meldung mit Verweis: „Meldung #5“ führt auf die Meldung', () => {
    const [v] = vermerkeVon(eintrag({ meldung_id: 40, meldung_lfd_nr: 5 }), kontext());
    expect(v).toMatchObject({ text: 'Meldung #5', ton: 'verweis' });
    expect(v.pfad).toContain('/einsaetze/7/meldungen');
    expect(v.pfad).toContain('meldung=40');
  });

  it('berichtigt: „berichtigt durch Nr. 231“, jüngste zuerst, je Berichtigung ein Sprung', () => {
    const v = vermerkeVon(
      eintrag({
        berichtigt_durch: [
          { id: 231, lfd_nr: 231 },
          { id: 240, lfd_nr: 240 },
        ],
      }),
      kontext(),
    );
    expect(v.map((x) => x.text)).toEqual(['berichtigt durch Nr. 240', 'berichtigt durch Nr. 231']);
    expect(v[1].pfad).toContain('eintrag=231');
  });

  it('eine Berichtigung nennt ihren Grundeintrag, ohne geladene Nummer ohne erfundene', () => {
    const geladen = vermerkeVon(
      eintrag({ typ: 'berichtigung', berichtigt_eintrag_id: 230 }),
      kontext({ grundeintrag: { id: 230, lfd_nr: 230 } }),
    );
    expect(geladen[0]).toMatchObject({ text: 'berichtigt Nr. 230' });
    expect(geladen[0].pfad).toContain('eintrag=230');
    const ungeladen = vermerkeVon(
      eintrag({ typ: 'berichtigung', berichtigt_eintrag_id: 230 }),
      kontext({ grundeintrag: { id: 230, lfd_nr: null } }),
    );
    expect(ungeladen[0].text).toBe('berichtigt einen älteren Eintrag');
  });

  it('Nachtrag: „Nachtrag · erfasst HHMM“ in der Achtungsrolle, mit Tag über Mitternacht', () => {
    const [v] = vermerkeVon(
      eintrag({ ereigniszeit: '2026-05-23 17:12:00', received_at: '2026-05-23 17:26:00' }),
      kontext(),
    );
    expect(v).toMatchObject({ text: 'Nachtrag · erfasst 1926', ton: 'achtung' });
    expect(v.pfad).toBeUndefined();
    const [tag] = vermerkeVon(
      eintrag({ ereigniszeit: '2026-05-23 21:50:00', received_at: '2026-05-23 22:10:00' }),
      kontext(),
    );
    expect(tag.text).toBe('Nachtrag · erfasst 240010');
  });

  it('nennt alle Verweise: Befehl, Lagebericht, Auftrag, Nachforderung, Einheit, Folgeauftrag', () => {
    const v = vermerkeVon(
      eintrag({
        befehl_id: 1,
        lagebericht_id: 2,
        auftrag_id: 3,
        nachforderung_id: 4,
        einheiten: [{ id: 5, name: 'Sanitätszug Musterstadt' }],
        folgeauftraege: [
          { id: 6, lfd_nr: 12 },
          { id: 7, lfd_nr: null },
        ],
      } as Partial<EtbEintragAnzeige>),
      kontext(),
    );
    expect(v.map((x) => x.text)).toEqual([
      'Befehl',
      'Lagebericht',
      'Auftrag',
      'Nachforderung',
      'Einheit «Sanitätszug Musterstadt»',
      'Folgeauftrag Nr. 12',
      'Folgeauftrag',
    ]);
    expect(v.every((x) => x.ton === 'verweis' && x.pfad)).toBe(true);
  });

  it('Anhänge und Dokumente sind Dateien zum Herunterladen, mit Nummer im Namen', () => {
    const v = vermerkeVon(
      eintrag({
        lfd_nr: 42,
        anhaenge: [
          { id: 9, dateiname: 'Lagefoto.jpg', mime: 'image/jpeg', groesse: 2048 },
        ] as EtbEintragAnzeige['anhaenge'],
      }),
      kontext({
        dokumente: [
          { id: 3, titel: 'Lageskizze', dateiname: 'skizze.pdf', groesse: 1024, mime: 'x' },
        ],
      }),
    );
    expect(v.map((x) => x.text)).toEqual(['Anhang Lagefoto.jpg', 'Dokument „Lageskizze“']);
    expect(v[0].datei!.dateiname).toBe('Lagefoto.jpg');
    expect(v[0].datei!.name).toMatch(/^Lagefoto\.jpg, .+, Anhang zu Nr\. 42 herunterladen$/);
    expect(v[0].datei!.href).toContain('/etb/1/anhaenge/9');
    expect(v[1].datei!.name).toMatch(/^Dokument „Lageskizze“, .+, zu Nr\. 42 herunterladen$/);
  });

  it('Reihenfolge: Berichtigung, Nachtrag, Verweise, Dateien', () => {
    const v = vermerkeVon(
      eintrag({
        ereigniszeit: '2026-05-23 17:12:00',
        received_at: '2026-05-23 17:26:00',
        meldung_id: 1,
        meldung_lfd_nr: 2,
        berichtigt_durch: [{ id: 3, lfd_nr: 3 }],
        anhaenge: [
          { id: 9, dateiname: 'a.pdf', mime: 'application/pdf', groesse: 10 },
        ] as EtbEintragAnzeige['anhaenge'],
      }),
      kontext(),
    );
    expect(v.map((x) => x.text)).toEqual([
      'berichtigt durch Nr. 3',
      'Nachtrag · erfasst 1926',
      'Meldung #2',
      'Anhang a.pdf',
    ]);
  });

  it('der Titel nennt alle Vermerke', () => {
    const v = vermerkeVon(eintrag({ meldung_id: 1, meldung_lfd_nr: 5, befehl_id: 2 }), kontext());
    expect(vermerkeTitel(v)).toBe('Befehl · Meldung #5');
  });
});
