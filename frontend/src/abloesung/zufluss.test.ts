import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import {
  eingeordnet,
  freigegeben,
  nachgefuehrt,
  teileZufluss,
  zuflussText,
  type Zuflussstand,
} from './zufluss';

dayjs.extend(utc);

const jetzt = dayjs.utc('2026-09-22 12:00:00');

function schicht(id: number, faellig_at = '2026-09-22 18:00:00'): Abloesung {
  return {
    id,
    einsatz_id: 1,
    einheit_id: 10 + id,
    einheit_name: `Florian ${id}`,
    beginn_at: '2026-09-22 09:30:00',
    rhythmus_minuten: 360,
    rhythmus_quelle: 'einheit',
    faellig_at,
    status: 'laufend',
    ruecknehmbar: false,
    angelegt_at: '2026-09-22 09:30:00',
  };
}

/** Gezeigter Stand; ohne eigenen Schlüssel ist die Karte nach der Vorgabe-Fälligkeit eingeordnet. */
const stand = (
  gezeigt: (number | [number, string])[] | null,
  eigene: number[] = [],
): Zuflussstand => ({
  gezeigt:
    gezeigt == null
      ? null
      : new Map(gezeigt.map((g) => (Array.isArray(g) ? g : [g, '2026-09-22 18:00:00']))),
  eigene: new Set(eigene),
});
const ids = (xs: readonly Abloesung[]) => xs.map((s) => s.id);

describe('teileZufluss — fremde Neuzugänge warten hinter dem Sammelbanner (LFH-647)', () => {
  it('ohne Stand (erste Lieferung) steht alles', () => {
    const r = teileZufluss([schicht(1), schicht(2)], stand(null));
    expect(ids(r.sichtbar)).toEqual([1, 2]);
    expect(r.zurueckgehalten).toEqual([]);
  });

  it('hält eine fremde neue Schicht zurück, auch wenn sie OBEN einsortiert ist', () => {
    const r = teileZufluss([schicht(9), schicht(1), schicht(2)], stand([1, 2]));
    expect(ids(r.sichtbar)).toEqual([1, 2]);
    expect(ids(r.zurueckgehalten)).toEqual([9]);
  });

  it('eine eigene neue Schicht steht sofort, an ihrem Fälligkeitsplatz', () => {
    const r = teileZufluss(
      [schicht(9, '2026-09-22 17:00:00'), schicht(1), schicht(2)],
      stand([1, 2], [9]),
    );
    expect(ids(r.sichtbar)).toEqual([9, 1, 2]);
    expect(r.zurueckgehalten).toEqual([]);
  });

  it('Entfallene fallen sofort weg; die Gezeigten behalten die Server-Ordnung', () => {
    const r = teileZufluss(
      [schicht(2, '2026-09-22 17:00:00'), schicht(1)],
      stand([1, [2, '2026-09-22 17:00:00'], 3]),
    );
    expect(ids(r.sichtbar)).toEqual([2, 1]);
  });

  it('bei null gezeigten Karten hält nichts zurück — es steht kein Cursor über einer Karte', () => {
    const r = teileZufluss([schicht(9)], stand([]));
    expect(ids(r.sichtbar)).toEqual([9]);
    expect(r.zurueckgehalten).toEqual([]);
    // Auch wenn alle gezeigten entfallen sind: der Leerzustand darf nicht neben einem Banner stehen.
    expect(ids(teileZufluss([schicht(9)], stand([1])).sichtbar)).toEqual([9]);
  });
});

describe('eingefrorene Folge — eine fremde Änderung der Fälligkeit ordnet nicht um (LFH-660)', () => {
  // Gezeigt: 1 fällig 14:00 über 2 fällig 16:00. Fremd wird 2 auf 11:50 vorgezogen.
  const gezeigt = (): Zuflussstand =>
    stand([
      [1, '2026-09-22 14:00:00'],
      [2, '2026-09-22 16:00:00'],
    ]);
  const umgeordnet = () => [schicht(2, '2026-09-22 11:50:00'), schicht(1, '2026-09-22 14:00:00')];

  it('die Karte bleibt an ihrem Platz, ihr Inhalt ist frisch, und die Abweichung wird gemeldet', () => {
    const r = teileZufluss(umgeordnet(), gezeigt());
    expect(ids(r.sichtbar)).toEqual([1, 2]);
    expect(r.sichtbar[1].faellig_at).toBe('2026-09-22 11:50:00');
    expect(r.umgeordnet).toBe(true);
    expect(r.zurueckgehalten).toEqual([]);
  });

  it('bei GLEICHER eingefrorener Fälligkeit entscheidet die Id wie beim Server, nicht dessen neue Folge', () => {
    // Im Browser gemessen: in derselben Sekunde begonnene Schichten tragen dieselbe Fälligkeit.
    // Ein stabiles Sortieren nach dem Schlüssel allein fiele bei Gleichstand auf die NEUE
    // Server-Folge zurück und ließe die fremd vorgezogene Karte doch springen.
    const gleich = stand([1, 2, 3]);
    const r = teileZufluss([schicht(2, '2026-09-22 12:20:00'), schicht(1), schicht(3)], gleich);
    expect(ids(r.sichtbar)).toEqual([1, 2, 3]);
    expect(r.umgeordnet).toBe(true);
  });

  it('eine Änderung, die die Folge nicht berührt, ist keine Umordnung', () => {
    const r = teileZufluss(
      [schicht(1, '2026-09-22 14:00:00'), schicht(2, '2026-09-22 15:00:00')],
      gezeigt(),
    );
    expect(ids(r.sichtbar)).toEqual([1, 2]);
    expect(r.umgeordnet).toBe(false);
  });

  it('eine eigene neue Schicht ordnet sich zwischen die eingefrorenen Plätze ein', () => {
    const r = teileZufluss(
      [
        schicht(2, '2026-09-22 11:50:00'),
        schicht(1, '2026-09-22 14:00:00'),
        schicht(9, '2026-09-22 15:00:00'),
      ],
      { ...gezeigt(), eigene: new Set([9]) },
    );
    expect(ids(r.sichtbar)).toEqual([1, 9, 2]);
  });

  it('nachgefuehrt hält bei Umordnung die Schlüssel und liefert null — sonst liefe der Render in eine Schleife', () => {
    const s = gezeigt();
    const r = teileZufluss(umgeordnet(), s);
    expect(nachgefuehrt(s, r.sichtbar, r.umgeordnet)).toBeNull();
  });

  it('ohne Umordnung übernimmt nachgefuehrt die frische Fälligkeit als Schlüssel', () => {
    const s = gezeigt();
    const r = teileZufluss(
      [schicht(1, '2026-09-22 14:00:00'), schicht(2, '2026-09-22 15:00:00')],
      s,
    );
    const n = nachgefuehrt(s, r.sichtbar, r.umgeordnet);
    expect(n!.gezeigt!.get(2)).toBe('2026-09-22 15:00:00');
    // … und ein zweites Nachführen ist still.
    expect(nachgefuehrt(n!, r.sichtbar, false)).toBeNull();
  });

  it('eingeordnet (eigene Änderung) nimmt nur die genannte Karte an ihren neuen Platz', () => {
    const n = eingeordnet(gezeigt(), [schicht(2, '2026-09-22 11:50:00')]);
    const r = teileZufluss(umgeordnet(), n);
    expect(ids(r.sichtbar)).toEqual([2, 1]);
    expect(r.umgeordnet).toBe(false);
    // Eine nicht gezeigte (zurückgehaltene) Schicht wird dabei nicht freigegeben.
    expect(eingeordnet(gezeigt(), [schicht(9)]).gezeigt!.has(9)).toBe(false);
  });

  it('freigegeben nimmt die frischen Fälligkeiten — danach steht die Server-Ordnung', () => {
    const n = freigegeben(gezeigt(), umgeordnet());
    const r = teileZufluss(umgeordnet(), n);
    expect(ids(r.sichtbar)).toEqual([2, 1]);
    expect(r.umgeordnet).toBe(false);
  });
});

describe('nachgefuehrt — der gezeigte Stand folgt der sichtbaren Menge', () => {
  it('unverändert ergibt null (kein Zustandswechsel, keine Render-Schleife)', () => {
    const s = stand([1, 2]);
    expect(nachgefuehrt(s, [schicht(1), schicht(2)], false)).toBeNull();
  });

  it('die erste Lieferung wird zum gezeigten Stand', () => {
    const n = nachgefuehrt(stand(null), [schicht(1), schicht(2)], false);
    expect([...n!.gezeigt!.keys()]).toEqual([1, 2]);
  });

  it('eine sichtbar gewordene eigene Schicht wandert von „eigene" nach „gezeigt"', () => {
    const n = nachgefuehrt(stand([1], [9]), [schicht(9), schicht(1)], false);
    expect([...n!.gezeigt!.keys()].sort()).toEqual([1, 9]);
    expect([...n!.eigene]).toEqual([]);
  });

  it('eine noch nicht eingetroffene eigene Schicht bleibt vorgemerkt', () => {
    const n = nachgefuehrt(stand([1], [9]), [schicht(1)], false);
    expect(n).toBeNull();
  });

  it('eine entfallene Karte verlässt den Stand — kehrt sie fremd zurück, ist sie Zuwachs', () => {
    // Fremder Vollzug nimmt 1 weg …
    const n = nachgefuehrt(stand([1, 2]), [schicht(2)], false);
    expect([...n!.gezeigt!.keys()]).toEqual([2]);
    // … fremde Rücknahme bringt sie oberhalb zurück: das wäre ein Sprung, also Banner.
    const r = teileZufluss([schicht(1), schicht(2)], n!);
    expect(ids(r.sichtbar)).toEqual([2]);
    expect(ids(r.zurueckgehalten)).toEqual([1]);
  });
});

describe('freigegeben — Banner oder Ansichtswechsel zeigen alles', () => {
  it('nimmt die volle Menge in den Stand und behält vorgemerkte eigene', () => {
    const laufende = [schicht(9, '2026-09-22 17:00:00'), schicht(1)];
    const n = freigegeben(stand([1], [7]), laufende);
    expect([...n.gezeigt!.keys()]).toEqual([9, 1]);
    expect([...n.eigene]).toEqual([7]);
    expect(ids(teileZufluss(laufende, n).sichtbar)).toEqual([9, 1]);
  });
});

describe('zuflussText', () => {
  it('Einzahl, Mehrzahl und fällige Zurückgehaltene', () => {
    expect(zuflussText([schicht(1)], jetzt)).toBe('1 neue Schicht');
    expect(zuflussText([schicht(1), schicht(2)], jetzt)).toBe('2 neue Schichten');
    // Eine zurückgehaltene fällige Schicht darf nicht still hinter dem Banner warten
    // (Prüfliste Kriterium 9): das Banner nennt sie.
    expect(zuflussText([schicht(1, '2026-09-22 11:50:00'), schicht(2)], jetzt)).toBe(
      '2 neue Schichten, davon 1 fällig',
    );
  });

  it('eine Umordnung wird gemeldet, eine dabei unten gehaltene fällige Schicht benannt (LFH-660, Kriterium 9)', () => {
    // Folge wie gezeigt: planmäßig 18:00 über der fremd vorgezogenen, jetzt fälligen 11:50.
    const gezeigt = [schicht(1, '2026-09-22 18:00:00'), schicht(2, '2026-09-22 11:50:00')];
    expect(zuflussText([], jetzt, gezeigt)).toBe(
      'Reihenfolge geändert, 1 fällige Schicht rückt nach oben',
    );
    // Rückt keine fällige nach oben, steht nur die Umordnung da.
    expect(zuflussText([], jetzt, [schicht(1, '2026-09-22 18:00:00'), schicht(2)])).toBe(
      'Reihenfolge geändert',
    );
    expect(zuflussText([schicht(9)], jetzt, [schicht(1), schicht(2)])).toBe(
      '1 neue Schicht · Reihenfolge geändert',
    );
    // Ohne Umordnung bleibt der Wortlaut aus LFH-647 byte-gleich.
    expect(zuflussText([schicht(9)], jetzt, null)).toBe('1 neue Schicht');
  });
});
