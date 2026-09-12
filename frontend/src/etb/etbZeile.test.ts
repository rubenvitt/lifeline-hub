import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { baueZeilen } from './etbZeile';

const E = (id: number): EtbEintragAnzeige =>
  ({
    id,
    lfd_nr: id,
    typ: 'meldung',
    inhalt: `Eintrag ${id}`,
    von: null,
    an: null,
    meldeweg: null,
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Admin',
    ereigniszeit: '2026-08-21 10:00:00',
    received_at: '2026-08-21 10:00:01',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
  }) as unknown as EtbEintragAnzeige;

const A = (id?: number): AusstehenderEintrag => ({
  id,
  benutzer_id: 1,
  einsatz_id: 7,
  eintrag: { typ: 'meldung', inhalt: 'ungesendet' },
  erstellt_at: '2026-08-21 10:05:00',
});

const X = (id?: number): AbgelehnterEintrag => ({
  ...A(id),
  grund: 'Einsatz abgeschlossen',
  abgelehnt_at: '2026-08-21 10:06:00',
});

describe('baueZeilen (LFH-342 · C7, Befund M82)', () => {
  it('stellt abgelehnte vor ausstehende vor die gesendeten Einträge', () => {
    const zeilen = baueZeilen({ eintraege: [E(1), E(2)], ausstehend: [A(9)], abgelehnt: [X(8)] });
    // Die Liste läuft neueste-zuerst; ein noch nicht gesendeter Eintrag ist der jüngste.
    // Abgelehnt steht davor, weil er eine Handlung verlangt und nicht bloß Geduld.
    expect(zeilen.map((z) => z.art)).toEqual(['abgelehnt', 'ausstehend', 'eintrag', 'eintrag']);
  });

  it('lässt die Serverordnung unangetastet', () => {
    const zeilen = baueZeilen({ eintraege: [E(5), E(3), E(4)], ausstehend: [], abgelehnt: [] });
    expect(zeilen.map((z) => (z.art === 'eintrag' ? z.eintrag.id : null))).toEqual([5, 3, 4]);
  });

  it('vergibt gepufferten Zeilen einen eigenen Schlüsselraum', () => {
    // Die Queue-`id` kollidiert mit der DB-`id`: ohne Präfix träfe das
    // `[data-row-key="…"]`-Highlight des Deeplinks `?eintrag=` die falsche Zeile.
    const zeilen = baueZeilen({ eintraege: [E(3)], ausstehend: [A(3)], abgelehnt: [X(3)] });
    expect(new Set(zeilen.map((z) => z.schluessel)).size).toBe(3);
    expect(zeilen.map((z) => z.schluessel)).toEqual(['abgelehnt-3', 'ausstehend-3', 'eintrag-3']);
  });

  it('kommt ohne id aus — die Queue vergibt sie erst beim Schreiben', () => {
    const zeilen = baueZeilen({ eintraege: [], ausstehend: [A(undefined)], abgelehnt: [] });
    expect(zeilen[0].schluessel).toBe('ausstehend-2026-08-21 10:05:00');
  });

  it('liefert für leere Mengen eine leere Chronologie', () => {
    // Die Gegenaussage zum Leerzustand: `baueZeilen` erfindet keine Zeile, wenn
    // nichts da ist — sonst wäre der leer-Zweig der Seite nie erreichbar.
    expect(baueZeilen({ eintraege: [], ausstehend: [], abgelehnt: [] })).toEqual([]);
  });
});
