import { describe, expect, it } from 'vitest';
import type { InfotelefonZaehler, MedienkontaktKennzahlen, Pressemitteilung } from '../api/types';
import { baueMedienlage, rendereMedienlageMarkdown, type MedienlageQuellen } from './medienlage';

/**
 * Kennzahlen des Presse-Logs, wie der Server sie über den ganzen Bestand rechnet (LFH-1075): drei
 * Kontakte, zwei Anfragen (eine offen) und ein Termin bei NDR 1 und RTL. Dazu Felder mit
 * Personenbezug, die ein Aufrufer versehentlich mitgeben könnte: die Ableitung darf sie nie
 * weitertragen.
 */
const KENNZAHLEN = {
  gesamt: 3,
  offen: 1,
  offene_anfragen: 1,
  je_art: { anfrage: 2, abstimmung: 0, termin: 1 },
  medien: ['NDR 1', 'RTL'],
  thema: 'Familie Meyer evakuiert?',
  kontakt_name: 'Maria Beispiel',
  kontaktweg: '+49 511 1234567',
} as MedienkontaktKennzahlen;

/**
 * Die Zählung des Informationstelefons, wie der Server sie über den ganzen Bestand rechnet
 * (LLH-732): zwei Anrufe, ein offener Rückruf. Dazu Felder mit Personenbezug, die ein Aufrufer
 * versehentlich mitgeben könnte.
 */
const ZAEHLER = {
  gesamt: 2,
  offen: 1,
  je_anliegen: {
    vermisstensuche: 1,
    auskunft_lage: 1,
    hinweis: 0,
    hilfeangebot: 0,
    beschwerde: 0,
    presse: 0,
    sonstiges: 0,
  },
  notiz: 'sucht Vater Klaus',
  anrufer_name: 'Klaus Meyer',
  rueckruf: '0171 7654321',
} as InfotelefonZaehler;

const PM = {
  id: 4,
  titel: 'Hochwasser Musterstadt',
  version: 2,
  status: 'freigegeben',
  freigegeben_at: '2026-09-30 13:00:00',
} as Pressemitteilung;

function quellen(teil: Partial<MedienlageQuellen> = {}): MedienlageQuellen {
  return {
    kontakte: { zustand: 'daten', daten: KENNZAHLEN },
    mitteilungen: { zustand: 'daten', daten: [PM, { ...PM, id: 5, status: 'entwurf' }] },
    anrufe: { zustand: 'daten', daten: ZAEHLER },
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

  it('nennt die Anrufe des ganzen Bestands, nicht die einer geladenen Seite (LLH-732)', () => {
    const text = rendereMedienlageMarkdown(
      baueMedienlage(
        quellen({
          anrufe: {
            zustand: 'daten',
            daten: {
              ...ZAEHLER,
              gesamt: 2000,
              offen: 200,
              je_anliegen: { ...ZAEHLER.je_anliegen, vermisstensuche: 1500, auskunft_lage: 500 },
            },
          },
        }),
      ),
      zeit,
    );
    expect(text).toContain('2000 Anrufe, davon 200 Rückrufe offen');
    expect(text).toContain('Vermisstensuche 1500, Auskunft zur Lage 500');
  });

  it('nennt ohne Antwort der Zählung den Grund, nie eine 0', () => {
    const m = baueMedienlage(quellen({ anrufe: { zustand: 'daten', daten: null } }));
    expect(m.anrufe).toEqual({ zustand: 'fehler' });
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
      'evakuiert',
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
          anrufe: { zustand: 'gesperrt', daten: null },
          kontakte: { zustand: 'fehler', daten: null },
        }),
      ),
      zeit,
    );
    expect(text).toContain('**Informationstelefon**\n- — (nicht freigegeben)');
    expect(text).toContain('**Medienkontakte**\n- — (nicht geladen)');
    expect(text).not.toContain('0 Anrufe');
    expect(text).toContain('Hochwasser Musterstadt');
  });

  it('nennt ein Medium, das nur im Leerraum abweicht, einmal', () => {
    const m = baueMedienlage(
      quellen({
        kontakte: { zustand: 'daten', daten: { ...KENNZAHLEN, medien: ['NDR 1', ' NDR 1 ', ' '] } },
      }),
    );
    expect(m.kontakte.zustand === 'daten' && m.kontakte.werte.medien).toEqual(['NDR 1']);
  });

  it('entschärft Markdown in Medien und Titeln', () => {
    const text = rendereMedienlageMarkdown(
      baueMedienlage(
        quellen({
          kontakte: { zustand: 'daten', daten: { ...KENNZAHLEN, medien: ['*Radio* #1'] } },
        }),
      ),
      zeit,
    );
    expect(text).toContain('Medien: \\*Radio\\* \\#1');
  });
});
