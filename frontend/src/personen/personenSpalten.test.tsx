import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pruefeKartenplan, type Kartenplan } from '../components/Datensicht';
import type { Person } from '../api/types';
import {
  SkTag,
  abgleichSpalten,
  geschlechtAlter,
  nameText,
  personenKarte,
  personenSpalten as spaltenFabrik,
  seitWert,
  verbleibText,
  type PersonenSpaltenKey,
} from './personenSpalten';

const uhsNamen: Record<number, string> = { 7: 'Weserstadion' };
const personenSpalten = spaltenFabrik((id) => uhsNamen[id]);

/**
 * Register- und Helferprüfungen der Personenspalten (LFH-330 · B2, Bündel I).
 *
 * Zwei Sorten Zusicherung, bewusst getrennt:
 *  · **reine Funktionen** (`seitWert`) — ohne Rendern, damit die Wertregel „Sichtung vor
 *    Erfassung" nicht an einer Zellendarstellung hängt.
 *  · **Registerform** — dass die `seit`-Spalte existiert, ihr `sortWert` DIESELBE Regel
 *    benutzt und der Kartenplan gegen das Register aufgeht. Letzteres über einen DIREKTEN
 *    Aufruf von `pruefeKartenplan`, wie in der API-Entscheidung vorgesehen: kein
 *    console-Spion, keine Abgrenzung gegen antd-Fremdwarnungen.
 */

const basis: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  // ABSICHTLICH ungleich `erfasst_at`. Im Bestand sind beide Felder in allen Fixtures
  // byte-gleich; ein Umbau von `erfasst_at` auf `geaendert_at` — fachlich falsch, weil
  // `geaendert_at` bei jeder Notiz weiterläuft — wäre darauf gemessen grün geblieben.
  geaendert_at: '2026-05-27 11:22:00',
  geaendert_von: 1,
  storniert_at: null,
};

describe('seitWert', () => {
  it('nimmt den Sichtungszeitpunkt, wenn er gesetzt ist', () => {
    const gesichtet: Person = {
      ...basis,
      aktuelle_sichtung: 'sk2',
      aktuelle_sichtung_at: '2026-05-27 09:40:00',
    };
    expect(seitWert(gesichtet)).toBe('2026-05-27 09:40:00');
  });

  it('fällt ohne Sichtung auf den Erfassungszeitpunkt zurück', () => {
    // Der Fall, der bei `p.aktuelle_sichtung_at?.` statt `??` durchfällt.
    expect(seitWert(basis)).toBe('2026-05-27 09:00:00');
  });

  it('fällt auch bei ausdrücklichem null auf den Erfassungszeitpunkt zurück', () => {
    expect(seitWert({ ...basis, aktuelle_sichtung_at: null })).toBe('2026-05-27 09:00:00');
  });

  it('liefert nie einen Leerwert — erfasst_at ist Pflichtfeld von PersonAnzeige', () => {
    // Gepinnt gegen einen späteren Umbau auf `geaendert_at` o. ä.: eine leere Zeitangabe
    // rendert als '' und wäre in der Spalte unsichtbar, statt aufzufallen.
    for (const p of [basis, { ...basis, aktuelle_sichtung_at: null }]) {
      expect(seitWert(p)).toBeTruthy();
    }
  });
});

describe('SkTag', () => {
  it('zeigt das Etikett der Sichtungskategorie', () => {
    render(<SkTag p={{ ...basis, aktuelle_sichtung: 'sk2' }} />);
    expect(screen.getByText('SK II')).toBeInTheDocument();
  });

  it('zeigt einen Gedankenstrich, wenn nicht gesichtet ist', () => {
    render(<SkTag p={basis} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('nameText', () => {
  it('setzt Name und Vorname zusammen', () => {
    expect(nameText(basis)).toBe('Mustermann, Max');
  });

  it('ist LEERWERTIG, wenn kein Name bekannt ist — nicht „unbekannt"', () => {
    // Sonst fände die Freitextsuche nach „unbekannt" jede namenlose Person als Namenstreffer.
    // Der Anzeigetext „unbekannt" gehört ins `render`, nicht in den Suchbeitrag.
    expect(nameText({ ...basis, name: null, vorname: null })).toBeNull();
  });

  it('trägt einen einzeln gesetzten Namensteil', () => {
    expect(nameText({ ...basis, vorname: null })).toBe('Mustermann');
    expect(nameText({ ...basis, name: null })).toBe(', Max');
  });
});

/** Hilfsgriff aufs Register — `key` ist Pflichtfeld, also ist das eindeutig. */
const spalte = (key: string) => personenSpalten.filter((s) => s.key === key);

describe('personenSpalten — Registerform (Neuentwurf S7)', () => {
  it('trägt die Spalten des Entwurfs, soweit es Daten gibt — ohne „Zustand" (LFH-613)', () => {
    expect(personenSpalten.map((s) => s.key)).toEqual([
      'reg',
      'person',
      'sk',
      'status',
      'fundort',
      'verbleib',
      'vermerk',
      'seit',
    ]);
  });

  it('sortiert seit über DIESELBE Regel, die die Zelle zeigt', () => {
    const sortWert = spalte('seit')[0].sortWert;
    expect(sortWert).toBeDefined();
    for (const p of [basis, { ...basis, aktuelle_sichtung_at: '2026-05-27 09:40:00' }]) {
      expect(sortWert!(p)).toBe(seitWert(p));
    }
  });

  it('macht Nr. sortierbar und suchbar, in der ANZEIGE-Schreibweise, und setzt sie Mono', () => {
    const reg = spalte('reg')[0];
    // Sortiert wird über die ZAHL (sonst läge R-10 vor R-9), gesucht über den Text, den
    // jemand auch eintippt.
    expect(reg.sortWert!(basis)).toBe(1);
    expect(reg.suchText!(basis)).toBe('R-001');
    expect(reg.immerSichtbar).toBe(true);
    expect(reg.zahl).toBe(true);
    expect(spalte('seit')[0].zahl).toBe(true);
  });

  it('lässt den Namen zur Suche beitragen, ohne „unbekannt" als Namen zu führen', () => {
    const person = spalte('person')[0];
    expect(person.suchText!(basis)).toBe('Mustermann, Max');
    expect(person.suchText!({ ...basis, name: null, vorname: null })).toBeFalsy();
  });

  it('staffelt die Nebenspalten über abBreite; Zeit und Verbleib tragen keine Schwelle', () => {
    expect(spalte('fundort')[0].abBreite).toBe('lg');
    expect(spalte('vermerk')[0].abBreite).toBe('xxl');
    // Eine Spalte mit Schwelle wäre in jeder jsdom-Prüfung unter 1200 px abwesend.
    expect(spalte('seit')[0].abBreite).toBeUndefined();
    expect(spalte('verbleib')[0].abBreite).toBeUndefined();
  });

  it('zeigt Person mit Geschlecht/Alter und schreibt eine Lücke als Wort aus', () => {
    const render_ = spalte('person')[0].render!;
    const { container, rerender } = render(<>{render_(undefined, basis, 0)}</>);
    expect(container.textContent).toBe('Mustermann, Maxm ~40Verbleib offen');
    rerender(<>{render_(undefined, { ...basis, aktueller_verbleib: 'entlassen' }, 0)}</>);
    expect(container.textContent).toBe('Mustermann, Maxm ~40');
    expect(container.querySelector('[data-lfh="luecke"]')).toBeNull();
  });
});

describe('geschlechtAlter / verbleibText', () => {
  it('schreibt Geschlecht und Alter in der Kurzform der Zeile', () => {
    expect(geschlechtAlter(basis)).toBe('m ~40');
    expect(geschlechtAlter({ ...basis, geschlecht: null, alter_geschaetzt: null })).toBeNull();
    expect(geschlechtAlter({ ...basis, geburtsdatum: '1990-01-02' })).toBe('m 1990-01-02');
  });

  it('nennt Kurzform, sonst die UHS beim Namen, sonst nichts', () => {
    const name = (id: number) => uhsNamen[id];
    expect(
      verbleibText({ aktueller_verbleib: 'Transport → KH Nord', aktuelle_uhs_id: 7 }, name),
    ).toBe('Transport → KH Nord');
    expect(verbleibText({ aktueller_verbleib: null, aktuelle_uhs_id: 7 }, name)).toBe(
      'UHS Weserstadion',
    );
    expect(verbleibText({ aktueller_verbleib: null, aktuelle_uhs_id: 99 }, name)).toBe('UHS');
    expect(verbleibText({ aktueller_verbleib: null, aktuelle_uhs_id: null }, name)).toBeNull();
  });
});

describe('personenKarte', () => {
  it('geht gegen das Register auf — inklusive Abgleichspalte', () => {
    // DIREKTER Aufruf, kein console-Spion: `pruefeKartenplan` fängt genau das
    // `const K`-Widening, das der Typ nicht sehen kann, wenn eine Spaltenliste annotiert
    // statt durch `spaltenFuer` geführt wird.
    expect(
      pruefeKartenplan({ spalten: personenSpalten, karte: personenKarte(1) }, 'Personen'),
    ).toEqual([]);
    expect(
      pruefeKartenplan(
        {
          spalten: [...personenSpalten, ...abgleichSpalten([], () => {})],
          karte: personenKarte(1),
        },
        'Personen',
      ),
    ).toEqual([]);
  });

  it('verlinkt den Titel auf die Personen-Detailseite', () => {
    const karte = personenKarte(7);
    if (karte.art !== 'plan') throw new Error('personenKarte ist ein Plan, kein Eigenbau');
    expect(karte.titel.spalte).toBe('reg');
    expect(karte.titel.ziel!(basis)).toBe('/einsaetze/7/personen/10');
  });

  it('führt Person, Sichtung und Zeit als Sekundärfelder, den Status im Status-Slot', () => {
    // `seit` gemessen als Lücke: ohne diese Zeile blieb das Register grün, während die Zeit
    // aus dem Kartenplan verschwand. `person` trägt im Kartenzweig den Lückenvermerk — ohne
    // sie hinge die Lückentönung dort ohne Wort.
    const karte = personenKarte(1);
    if (karte.art !== 'plan') throw new Error('personenKarte ist ein Plan, kein Eigenbau');
    expect(karte.sekundaer).toEqual(['person', 'sk', 'seit']);
    expect(karte.status!({ ...basis, status: 'vermisst' })).toMatchObject({ label: 'vermisst' });
  });

  it('lehnt einen Tippfehler im Sekundärslot schon am Typcheck ab', () => {
    /**
     * Der Riegel VOR der Laufzeit, und er ist selbsttragend: weitet `K` auf `string` (weil
     * jemand die Spaltenliste annotiert statt sie durch `spaltenFuer` zu führen), dann
     * kompiliert die Zeile darunter — und `@ts-expect-error` wird selbst zum tsc-Fehler
     * („unused directive"). Diese Prüfung kann also nur an EINER Stelle grün sein.
     */
    const kaputt: Kartenplan<Person, PersonenSpaltenKey> = {
      art: 'plan',
      titel: { spalte: 'reg' },
      // @ts-expect-error 'seitt' ist kein Schlüssel des Registers
      sekundaer: ['seitt'],
    };
    expect(kaputt.art).toBe('plan');
  });

  it('meldet einen Tippfehler im Kartenplan, statt ihn zu schlucken', () => {
    // Gegenprobe zur Zusicherung oben: ohne sie wäre `toEqual([])` auch bei einem
    // wirkungslosen `pruefeKartenplan` grün.
    const befunde = pruefeKartenplan(
      {
        spalten: personenSpalten,
        karte: { art: 'plan', titel: { spalte: 'reg' }, sekundaer: ['seitt' as 'seit'] },
      },
      'Personen',
    );
    expect(befunde).toHaveLength(1);
    expect(befunde[0]).toContain('seitt');
  });
});
