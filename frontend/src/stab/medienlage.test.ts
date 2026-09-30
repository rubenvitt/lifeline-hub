import { describe, expect, it } from 'vitest';
import type { InfotelefonAnruf, Medienkontakt, Pressemitteilung } from '../api/types';
import { baueMedienlage, rendereMedienlageMarkdown, type MedienlageQuellen } from './medienlage';

/** Volle DTOs MIT Personenbezug: die Ableitung darf davon nichts weitertragen. */
const KONTAKTE: Medienkontakt[] = [
  {
    id: 1,
    einsatz_id: 7,
    art: 'anfrage',
    medium: 'NDR 1',
    thema: 'Familie Meyer evakuiert?',
    kontakt_name: 'Maria Beispiel',
    kontakt_erreichbarkeit: '+49 511 1234567',
    eingang_at: '2026-09-30 10:00:00',
    status: 'offen',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 10:00:00',
  },
  {
    id: 2,
    einsatz_id: 7,
    art: 'anfrage',
    medium: 'NDR 1',
    thema: 'Pegel',
    eingang_at: '2026-09-30 11:00:00',
    status: 'beantwortet',
    antwort: 'Pegel steigt',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 11:00:00',
  },
  {
    id: 3,
    einsatz_id: 7,
    art: 'termin',
    medium: 'RTL',
    thema: 'Dreh am Deich',
    eingang_at: '2026-09-30 12:00:00',
    status: 'erledigt',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 12:00:00',
  },
];

const ANRUFE: InfotelefonAnruf[] = [
  {
    id: 1,
    einsatz_id: 7,
    anliegen: 'vermisstensuche',
    notiz: 'sucht Vater Klaus',
    anrufer_name: 'Klaus Meyer',
    rueckruf: '0171 7654321',
    status: 'offen',
    eingang_at: '2026-09-30 10:00:00',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 10:00:00',
  },
  {
    id: 2,
    einsatz_id: 7,
    anliegen: 'auskunft_lage',
    status: 'erledigt',
    eingang_at: '2026-09-30 10:05:00',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 10:05:00',
  },
];

const PM = {
  id: 4,
  titel: 'Hochwasser Musterstadt',
  version: 2,
  status: 'freigegeben',
  freigegeben_at: '2026-09-30 13:00:00',
} as Pressemitteilung;

function quellen(teil: Partial<MedienlageQuellen> = {}): MedienlageQuellen {
  return {
    kontakte: { zustand: 'daten', daten: KONTAKTE },
    mitteilungen: { zustand: 'daten', daten: [PM, { ...PM, id: 5, status: 'entwurf' }] },
    anrufe: { zustand: 'daten', daten: ANRUFE },
    ...teil,
  };
}

const zeit = (w: string) => `[${w}]`;

describe('Medienlage (LFH-554)', () => {
  it('zählt Kontakte, Medien, freigegebene Mitteilungen und Anrufe', () => {
    const m = baueMedienlage(quellen());
    expect(m.kontakte).toEqual({
      zustand: 'daten',
      werte: {
        gesamt: 3,
        offen: 1,
        jeArt: { anfrage: 2, abstimmung: 0, termin: 1 },
        medien: ['NDR 1', 'RTL'],
      },
    });
    expect(m.mitteilungen).toEqual({
      zustand: 'daten',
      werte: {
        freigegeben: [
          { titel: 'Hochwasser Musterstadt', version: 2, freigegebenAt: '2026-09-30 13:00:00' },
        ],
      },
    });
    expect(m.anrufe.zustand === 'daten' && m.anrufe.werte.offeneRueckrufe).toBe(1);
  });

  it('trägt keinen Personenbezug in den Text — weder Namen noch Nummern noch Notizen oder Themen', () => {
    const text = rendereMedienlageMarkdown(baueMedienlage(quellen()), zeit);
    for (const pii of [
      'Maria Beispiel',
      '1234567',
      'Klaus',
      'Meyer',
      '7654321',
      'sucht Vater',
      'Familie',
      'Dreh am Deich',
      'Pegel steigt',
    ]) {
      expect(text, pii).not.toContain(pii);
    }
    expect(text).toContain('3 gesamt, davon 1 offen (Anfrage 2, Termin 1)');
    expect(text).toContain('Medien: NDR 1, RTL');
    expect(text).toContain('[2026-09-30 13:00:00] · Hochwasser Musterstadt (v2)');
    expect(text).toContain('2 Anrufe, davon 1 Rückrufe offen');
    expect(text).toContain('Vermisstensuche 1, Auskunft zur Lage 1');
  });

  it('nennt für eine fehlende Quelle den Grund, nie eine 0', () => {
    const text = rendereMedienlageMarkdown(
      baueMedienlage(
        quellen({
          anrufe: { zustand: 'gesperrt', daten: [] },
          kontakte: { zustand: 'fehler', daten: [] },
        }),
      ),
      zeit,
    );
    expect(text).toContain('**Informationstelefon**\n- — (nicht freigegeben)');
    expect(text).toContain('**Medienkontakte**\n- — (nicht geladen)');
    expect(text).not.toContain('0 Anrufe');
    expect(text).toContain('Hochwasser Musterstadt');
  });

  it('entschärft Markdown in Medien und Titeln', () => {
    const text = rendereMedienlageMarkdown(
      baueMedienlage(
        quellen({
          kontakte: { zustand: 'daten', daten: [{ ...KONTAKTE[0], medium: '*Radio* #1' }] },
        }),
      ),
      zeit,
    );
    expect(text).toContain('Medien: \\*Radio\\* \\#1');
  });
});
