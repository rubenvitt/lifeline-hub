import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { grossMass } from '../../components/grossbild';
import LagebildGrossbild, { GEFAHREN_HOECHSTENS } from './LagebildGrossbild';
import type { KennzahlAnzeige } from './kennzahlAnzeige';
import type { GefahrenZeile, SichtungsZeile } from './lageVerdichtung';
import type { Verlauf } from './verlauf';

function kz(
  titel: string,
  wert: string | number,
  mehr: Partial<KennzahlAnzeige> = {},
): KennzahlAnzeige {
  return { titel, wert, notiz: '', ton: 'neutral', zustand: 'daten', ...mehr };
}

const BAND: KennzahlAnzeige[] = [
  kz('Verbleib offen', '12'),
  kz('Betroffene', '248', { notiz: '· 2 ohne Sichtung' }),
  kz('Schäden offen', '—', { notiz: 'nicht freigegeben' }),
  kz('Kräfte', '0/12/58//70'),
  kz('Vermisste', '3', { ton: 'alarm', notiz: '1 seit über 4 h' }),
  kz('Einsatzdauer', '5:01', { einheit: 'h' }),
];

const FUEHRUNG: KennzahlAnzeige[] = [
  kz('Lagebericht', 'keiner', { notiz: 'noch nicht erstellt' }),
  kz('UHS aktiv', 3, { notiz: '1 geplant · 24 Kräfte an UHS' }),
];

const gefahr = (typ: string, stufe: GefahrenZeile['stufe']): GefahrenZeile =>
  ({ typ, label: typ, stufe, mitErlaeuterung: false }) as GefahrenZeile;

const SICHTUNG: SichtungsZeile[] = [
  { kategorie: 'sk1', wert: 4, anteil: 0 },
  { kategorie: 'sk2', wert: 11, anteil: 0 },
  { kategorie: 'sk3', wert: 63, anteil: 0 },
  { kategorie: 'sk4', wert: 0, anteil: 0 },
];

const LEERER_VERLAUF: Verlauf = { stunden: [], imFenster: 0, spitze: null };

function renderGrossbild(mehr: Partial<Parameters<typeof LagebildGrossbild>[0]> = {}) {
  return render(
    <LagebildGrossbild
      einsatz={undefined}
      meta="1430 · Stand vor 12 s"
      kennzahlen={BAND}
      sanitaetsdienst={false}
      gefahren={{
        zustand: 'daten',
        zeilen: [gefahr('Sturm', 'mittel'), gefahr('Hochwasser', 'hoch')],
        gebiete: 4,
        beurteilung: null,
      }}
      verlauf={{ zustand: 'daten', verlauf: LEERER_VERLAUF }}
      sichtung={{ zustand: 'daten', zeilen: SICHTUNG, erfasst: 248, ohneSichtung: 2 }}
      fuehrung={FUEHRUNG}
      onVerlassen={() => undefined}
      {...mehr}
    />,
  );
}

function kennzahl(titel: string): HTMLElement {
  return screen.getByText(titel).closest('[data-lfh="gross-kennzahl"]') as HTMLElement;
}

describe('LagebildGrossbild (LLH-1747, Spec `grossbild-ansicht`, „Inhalt des Großbilds im Lagebild“)', () => {
  it('zeigt Titel, Uhrzeit und Datenstand', () => {
    renderGrossbild();
    expect(screen.getByRole('dialog', { name: 'Lagebild' })).toBeInTheDocument();
    expect(screen.getByText('1430 · Stand vor 12 s')).toBeInTheDocument();
  });

  it('zeigt die sechs Kennzahlen der Reihe mit ihren Werten und Tönen', () => {
    renderGrossbild();
    const band = screen.getByRole('group', { name: 'Lage in Zahlen' });
    expect(
      within(band).getAllByText((_, el) => el?.getAttribute('data-lfh') === 'gross-kennzahl'),
    ).toHaveLength(6);
    expect(kennzahl('Betroffene')).toHaveTextContent('248');
    expect(kennzahl('Schäden offen')).toHaveTextContent('—nicht freigegeben');
    expect(kennzahl('Vermisste').dataset.ton).toBe('alarm');
    expect(kennzahl('Einsatzdauer')).toHaveTextContent('5:01h');
  });

  it('setzt eine lange Zahl kleiner, damit sie in ihre Spalte passt', () => {
    renderGrossbild();
    expect(screen.getByText('0/12/58//70').style.fontSize).toBe(grossMass(72));
    expect(screen.getByText('248').style.fontSize).toBe(grossMass(96));
  });

  it('zeigt vor dem Lagebild sechs ladende Plätze', () => {
    renderGrossbild({ kennzahlen: null });
    const band = screen.getByRole('group', { name: 'Lage in Zahlen' });
    const zellen = band.querySelectorAll('[data-lfh="gross-kennzahl"]');
    expect(zellen).toHaveLength(6);
    for (const z of zellen) expect(z).toHaveAttribute('data-zustand', 'laden');
  });

  it('zeigt den Stand ohne Aufträge und Meldungen (LLH-1743)', () => {
    renderGrossbild();
    const block = screen.getByRole('region', { name: 'Stand' });
    expect(block).toHaveTextContent('Lagebericht');
    expect(block).toHaveTextContent('1 geplant · 24 Kräfte');
    expect(block).not.toHaveTextContent('Aufträge');
    expect(block).not.toHaveTextContent('Meldungen');
  });

  it('ordnet Gefahren nach Warnstufe und begrenzt sie', () => {
    const viele = [
      gefahr('A', 'niedrig'),
      gefahr('B', 'akut'),
      gefahr('C', 'mittel'),
      gefahr('D', 'hoch'),
      gefahr('E', 'niedrig'),
      gefahr('F', 'niedrig'),
      gefahr('G', 'niedrig'),
    ];
    renderGrossbild({
      gefahren: {
        zustand: 'daten',
        zeilen: viele,
        gebiete: 3,
        beurteilung: '3 Gebiete unbestätigt',
      },
    });
    const block = screen.getByRole('region', { name: 'Gefahren' });
    const zeilen = within(block).getAllByRole('listitem');
    expect(zeilen).toHaveLength(GEFAHREN_HOECHSTENS);
    expect(zeilen.map((z) => z.textContent)).toEqual([
      'Bakut',
      'Dhoch',
      'Cmittel',
      'Aniedrig',
      'Eniedrig',
    ]);
    expect(block).toHaveTextContent(`+ ${viele.length - GEFAHREN_HOECHSTENS} weitere`);
    expect(block).toHaveTextContent('3 Gebiete unbestätigt');
    // Ein langer Hinweis endet nach zwei Zeilen mit „…“, der ganze Text bleibt im `title`.
    const hinweis = within(block).getByText('3 Gebiete unbestätigt');
    expect(hinweis).toHaveAttribute('title', '3 Gebiete unbestätigt');
    expect(hinweis.style.webkitLineClamp).toBe('2');
    expect(within(block).getByText('akut').closest('[role="listitem"]')).toBeTruthy();
  });

  it('zeigt die Sichtung mit Kategorie, Zahl und „ohne Sichtung“', () => {
    renderGrossbild();
    const block = screen.getByRole('region', { name: 'Sichtung' });
    expect(block).toHaveTextContent('248 erfasst');
    const zeilen = within(block)
      .getAllByRole('listitem')
      .map((z) => z.textContent);
    expect(zeilen).toEqual(['SK I4', 'SK II11', 'SK III63', 'SK IV0', 'ohne Sichtung2']);
  });

  it('zeigt in der Reihe „Sanitätsdienst“ den Verlauf statt der Gefahren', () => {
    renderGrossbild({
      sanitaetsdienst: true,
      verlauf: {
        zustand: 'daten',
        verlauf: {
          imFenster: 5,
          stunden: [
            { stunde: '09', gesamt: 1, laufend: false },
            { stunde: '10', gesamt: 0, laufend: false },
            { stunde: '11', gesamt: 4, laufend: false },
            { stunde: '12', gesamt: 1, laufend: false },
            { stunde: '13', gesamt: 3, laufend: false },
            { stunde: '14', gesamt: 2, laufend: true },
          ] as Verlauf['stunden'],
          spitze: { stunde: '13', gesamt: 3 } as Verlauf['spitze'],
        },
      },
    });
    expect(screen.queryByRole('region', { name: 'Gefahren' })).toBeNull();
    const block = screen.getByRole('region', { name: 'Verlauf' });
    expect(
      within(block)
        .getAllByRole('listitem')
        .map((z) => z.textContent),
      // Vier Stunden, jüngste zuerst: fünf ragten samt „Spitze“ über die Höhe (Review vor dem PR).
    ).toEqual(['14 Uhr · laufend2', '13 Uhr3', '12 Uhr1', '11 Uhr4']);
    expect(block).toHaveTextContent('Spitze 13 Uhr · 3');
  });

  it('nennt gesperrte, ladende und leere Blöcke mit Grund', () => {
    renderGrossbild({
      gefahren: { zustand: 'gesperrt', zeilen: [], gebiete: 0, beurteilung: null },
      sichtung: { zustand: 'laden', zeilen: [], erfasst: 0, ohneSichtung: 0 },
    });
    expect(screen.getByRole('region', { name: 'Gefahren' })).toHaveTextContent('nicht freigegeben');
    expect(screen.getByRole('region', { name: 'Sichtung' })).toHaveTextContent('wird abgerufen');
  });

  it('führt nirgendwohin und zeigt keine ETB-Einträge', () => {
    renderGrossbild();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('a')).toBeNull();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).not.toContain('ETB');
    expect(dialog).not.toHaveTextContent('Jüngste');
  });
});
