import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import type { LageberichtAbschnitt, LageberichtKopf } from '../api/types';
import {
  abschnittsFuellstand,
  hatNachfolger,
  kernAbschnitt,
  teileUebersicht,
  textAuszug,
  titelVorschlag,
} from './uebersicht';

function kopf(teil: Partial<LageberichtKopf> & { id: number }): LageberichtKopf {
  return {
    einsatz_id: 7,
    vorlage: 'lagebericht',
    titel: `Bericht ${teil.id}`,
    zeitstand: '2026-06-02 10:00:00',
    status: 'freigegeben',
    version: 1,
    vorgaenger_id: null,
    ersteller_id: 1,
    ersteller_name: 'A',
    erstellt_at: '2026-06-02 10:00:00',
    freigegeben_von_id: null,
    freigegeben_von_name: null,
    freigegeben_at: null,
    etb_eintrag_id: null,
    ...teil,
  };
}

describe('teileUebersicht', () => {
  it('nimmt die jüngste Freigabe nach Zeitstand als aktuellen Stand, nicht die zuletzt angelegte', () => {
    const t = teileUebersicht([
      kopf({ id: 30, zeitstand: '2026-06-02 09:00:00' }),
      kopf({ id: 10, zeitstand: '2026-06-02 12:00:00' }),
      kopf({ id: 20, zeitstand: '2026-06-02 11:00:00' }),
    ]);
    expect(t.aktuell?.id).toBe(10);
    expect(t.verlauf.map((b) => b.id)).toEqual([20, 30]);
  });

  it('entscheidet bei gleichem Zeitstand über die höhere Kennung', () => {
    const t = teileUebersicht([kopf({ id: 4 }), kopf({ id: 5 })]);
    expect(t.aktuell?.id).toBe(5);
    expect(t.verlauf.map((b) => b.id)).toEqual([4]);
  });

  it('hat ohne Freigabe keinen aktuellen Stand und keinen Verlauf', () => {
    const t = teileUebersicht([kopf({ id: 1, status: 'entwurf' })]);
    expect(t.aktuell).toBeNull();
    expect(t.verlauf).toEqual([]);
    expect(t.inArbeit.map((b) => b.id)).toEqual([1]);
  });

  it('ordnet Entwürfe jüngster Zeitstand zuerst', () => {
    const t = teileUebersicht([
      kopf({ id: 1, status: 'entwurf', zeitstand: '2026-06-02 08:00:00' }),
      kopf({ id: 2, status: 'entwurf', zeitstand: '2026-06-02 09:00:00' }),
    ]);
    expect(t.inArbeit.map((b) => b.id)).toEqual([2, 1]);
  });

  it('verliert keinen Bericht, auch nicht in einer Kette mit Zyklus', () => {
    // Datenfehler wie in `ketten.test.ts`: 1 → 2 → 1. Die Übersicht liest keine Kette, jeder
    // Bericht steht genau einmal.
    const berichte = [
      kopf({ id: 1, vorgaenger_id: 2, zeitstand: '2026-06-02 08:00:00' }),
      kopf({ id: 2, vorgaenger_id: 1, zeitstand: '2026-06-02 09:00:00' }),
      kopf({ id: 3, status: 'entwurf', vorgaenger_id: 2, version: 2 }),
      kopf({ id: 4, zeitstand: '2026-06-02 07:00:00' }),
    ];
    const t = teileUebersicht(berichte);
    const gezeigt = [t.aktuell, ...t.inArbeit, ...t.verlauf].map((b) => b?.id).sort();
    expect(gezeigt).toEqual([1, 2, 3, 4]);
  });
});

describe('hatNachfolger', () => {
  it('erkennt einen fortgeschriebenen Bericht', () => {
    const berichte = [kopf({ id: 1 }), kopf({ id: 2, vorgaenger_id: 1, status: 'entwurf' })];
    expect(hatNachfolger(berichte, 1)).toBe(true);
    expect(hatNachfolger(berichte, 2)).toBe(false);
  });
});

describe('abschnittsFuellstand', () => {
  const abs = (teile: Record<string, string>): LageberichtAbschnitt[] =>
    Object.entries(teile).map(([schluessel, text]) => ({ schluessel, text }));

  it('zählt gefüllte Abschnitte gegen die Zahl der Vorlage, Leerraum zählt nicht', () => {
    expect(
      abschnittsFuellstand(
        'lagebericht',
        abs({ auftrag: 'A', eigene_lage: '  ', medienlage: 'x' }),
      ),
    ).toEqual({ gefuellt: 2, gesamt: 8 });
  });

  it('zählt einen fehlenden Abschnitt der Vorlage als leer und einen fremden Schlüssel nicht', () => {
    expect(abschnittsFuellstand('freitext', abs({ fremd: 'x' }))).toEqual({
      gefuellt: 0,
      gesamt: 1,
    });
  });

  it('kennt eine unbekannte Vorlage nicht', () => {
    expect(abschnittsFuellstand('gibtsnicht', [])).toBeNull();
  });
});

describe('kernAbschnitt', () => {
  it('nennt je Vorlage den Abschnitt, der die Lage zusammenfasst', () => {
    expect(kernAbschnitt('lagebericht')?.label).toBe('Zusammenfassung');
    expect(kernAbschnitt('lagebeurteilung')?.label).toBe('Vorschlag der besten Möglichkeit');
    expect(kernAbschnitt('freitext')?.label).toBe('Bericht');
    expect(kernAbschnitt('gibtsnicht')).toBeUndefined();
  });
});

describe('textAuszug', () => {
  it('nimmt die ersten drei Zeilen mit Text und meldet die Kürzung', () => {
    expect(textAuszug('eins\n\nzwei\ndrei\nvier')).toEqual({
      text: 'eins\n\nzwei\ndrei',
      gekuerzt: true,
    });
  });

  it('lässt einen kurzen Text ganz', () => {
    expect(textAuszug('eins\nzwei\n')).toEqual({ text: 'eins\nzwei', gekuerzt: false });
  });

  it('liefert für leeren Text nichts', () => {
    expect(textAuszug('  \n ')).toBeNull();
  });
});

describe('titelVorschlag', () => {
  const formatiere = (d: dayjs.Dayjs, f: string) => d.format(f);
  const jetzt = dayjs('2026-06-02T14:10:00');

  it('nennt die Uhrzeit taktisch je Vorlage', () => {
    expect(titelVorschlag('lagebericht', jetzt, formatiere)).toBe('Lageüberblick 1410');
    expect(titelVorschlag('lagebeurteilung', jetzt, formatiere)).toBe('Lagebeurteilung 1410');
    expect(titelVorschlag('freitext', jetzt, formatiere)).toBe('Bericht 1410');
  });
});
