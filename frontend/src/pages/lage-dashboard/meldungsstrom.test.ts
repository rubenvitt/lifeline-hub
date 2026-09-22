import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../../api/types';
import {
  bannerText,
  hoechsteLfdNr,
  stromAuswahl,
  stromQuelle,
  stromZeit,
  wassermarkeNachziehen,
} from './meldungsstrom';

const e = (lfd: number, over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige =>
  ({
    id: lfd,
    lfd_nr: lfd,
    typ: 'meldung',
    inhalt: `Eintrag ${lfd}`,
    ereigniszeit: '2026-06-11 09:00:00',
    erfasser_name: 'Vitt',
    folgeauftraege: [],
    ...over,
  }) as EtbEintragAnzeige;

describe('stromAuswahl', () => {
  it('sortiert selbst nach lfd. Nr. absteigend und deckelt die Menge', () => {
    const a = stromAuswahl([e(2), e(9), e(4), e(7)], null, 3);
    expect(a.sichtbar.map((x) => x.lfd_nr)).toEqual([9, 7, 4]);
    expect(a.hoechste).toBe(9);
    expect(a.neu).toBe(0);
  });

  it('hält Einträge über der Wassermarke zurück und zählt sie', () => {
    const a = stromAuswahl([e(1), e(2), e(3), e(4)], 2);
    expect(a.sichtbar.map((x) => x.lfd_nr)).toEqual([2, 1]);
    expect(a.neu).toBe(2);
    expect(a.neuMindestens).toBe(false);
  });

  it('markiert den Zähler als Untergrenze, wenn der ganze Abruf neu ist', () => {
    const a = stromAuswahl([e(5), e(6)], 2);
    expect(a.neu).toBe(2);
    expect(a.neuMindestens).toBe(true);
  });
});

describe('wassermarkeNachziehen', () => {
  it('beim ersten Abruf: ja — auch bei leerem Strom', () => {
    expect(wassermarkeNachziehen([e(1)], null)).toBe(true);
    expect(wassermarkeNachziehen([], null)).toBe(true);
  });

  it('steht unter der Marke noch etwas, bleibt sie stehen — das ist der Schutz vor dem Einschieben', () => {
    expect(wassermarkeNachziehen([e(1), e(2), e(3)], 2)).toBe(false);
  });

  it('steht unter ihr nichts mehr, zieht sie nach — über einer leeren Fläche springt nichts', () => {
    expect(wassermarkeNachziehen([e(1)], 0)).toBe(true);
  });

  it('ist sie schon auf dem jüngsten Stand, bleibt sie (kein Render-Kreislauf)', () => {
    expect(wassermarkeNachziehen([], 0)).toBe(false);
    expect(wassermarkeNachziehen([e(3)], hoechsteLfdNr([e(3)]))).toBe(false);
  });
});

describe('bannerText', () => {
  it('Einzahl, Mehrzahl und Untergrenze', () => {
    expect(bannerText(1, false)).toBe('1 neuer Eintrag');
    expect(bannerText(4, false)).toBe('4 neue Einträge');
    expect(bannerText(30, true)).toBe('Mindestens 30 neue Einträge');
  });
});

describe('stromQuelle', () => {
  it('„von · Meldeweg"', () => {
    expect(stromQuelle(e(1, { von: 'Deichwache Nord', meldeweg: 'funk' }))).toBe(
      'Deichwache Nord · Funk',
    );
  });

  it('ohne `von` der Erfasser, ohne Meldeweg nichts erfunden', () => {
    expect(stromQuelle(e(1, { von: '  ', meldeweg: null }))).toBe('Vitt');
    expect(stromQuelle(e(1, { meldeweg: 'persoenlich' }))).toBe('Vitt · Persönlich');
  });

  it('ohne `von` trägt der Erfasser seinen Funktions-Snapshot (LFH-615)', () => {
    expect(stromQuelle(e(1, { erfasser_funktion: 'S2', meldeweg: 'funk' }))).toBe(
      'Vitt ·\u00A0S2 · Funk',
    );
    // Ein gesetztes `von` bleibt die Herkunft — die Funktion des Erfassers ist dann nicht die Quelle.
    expect(stromQuelle(e(1, { von: 'Deichwache Nord', erfasser_funktion: 'S2' }))).toBe(
      'Deichwache Nord',
    );
  });
});

describe('stromZeit', () => {
  it('zeigt die Ereigniszeit in der Anzeigezone', () => {
    expect(stromZeit(e(1), { zeitzone: 'Europe/Berlin' })).toBe('11:00');
  });
});
