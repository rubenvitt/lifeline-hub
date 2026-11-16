import { render, screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { LagebesprechungStand } from '../api/types';
import LagebesprechungGrossbild from './LagebesprechungGrossbild';
import type { VorbereitungsZeile } from './vorbereitung';

dayjs.extend(utc);

const wire = (ms: number) => dayjs.utc(ms).format('YYYY-MM-DD HH:mm:ss');

function zeile(
  schluessel: string,
  titel: string,
  wert: string,
  notiz: string | null = null,
): VorbereitungsZeile {
  return { schluessel, titel, wert, notiz, quelle: titel, zustand: 'daten' };
}

const ZEILEN: VorbereitungsZeile[] = [
  zeile('betroffene', 'Betroffene', '248', 'davon 3 vermisst'),
  zeile('sichtung', 'Sichtung', 'SK I 4 · SK II 11 · SK III 63 · SK IV 0'),
  zeile('kraefte', 'Kräfte', '0/12/58//70'),
  zeile('warnstufe', 'Höchste Warnstufe', 'hoch', '2 Gebiete'),
  zeile('auftraege', 'Aufträge offen', '5', '1 überfällig'),
  zeile('meldungen', 'Meldungen offen', '9', '2 neu'),
  {
    ...zeile('nachforderungen', 'Nachforderungen offen', '—', 'nicht freigegeben'),
    zustand: 'gesperrt',
  },
  zeile('lagebericht', 'Lagebericht', '1400', 'freigegeben'),
  zeile('besprechung', 'Letzte Lagebesprechung', 'Nr. 3', '1330'),
  zeile('termin', 'Nächster Termin', '1430'),
];

function stand(terminMs: number | null): LagebesprechungStand {
  return {
    naechste_lagebesprechung_at: terminMs == null ? null : wire(terminMs),
    anzahl_lagebesprechungen: 3,
    letzte_lagebesprechung: { lfd_nr: 3 },
  } as unknown as LagebesprechungStand;
}

function zeige(terminMs: number | null = Date.now() + 25 * 60_000) {
  return render(
    <LagebesprechungGrossbild
      einsatz={undefined}
      stand={stand(terminMs)}
      standZustand="daten"
      vorbereitung={{ zeilen: ZEILEN, standWire: '2026-11-16 13:32:00', laedt: false }}
      onVerlassen={() => undefined}
    />,
  );
}

const kennzahl = (titel: string) =>
  screen.getByText(titel).closest('[data-lfh="gross-kennzahl"]') as HTMLElement;

describe('LagebesprechungGrossbild (LLH-1747, Spec `grossbild-ansicht`)', () => {
  it('zeigt Termin und abgeschlossene Besprechungen', () => {
    zeige();
    expect(screen.getByRole('dialog', { name: 'Lagebesprechung' })).toBeInTheDocument();
    expect(kennzahl('Nächste Lagebesprechung')).toHaveTextContent(/in 2[45] min/);
    expect(kennzahl('Abgeschlossen')).toHaveTextContent('3');
    expect(kennzahl('Abgeschlossen')).toHaveTextContent('zuletzt Nr. 3');
  });

  it('zeigt einen überfälligen Termin mit Wort und Ton `achtung`', () => {
    zeige(Date.now() - 5 * 60_000 - 30_000);
    const termin = kennzahl('Nächste Lagebesprechung');
    expect(termin).toHaveTextContent('seit 5 min überfällig');
    expect(termin).toHaveAttribute('data-ton', 'achtung');
  });

  it('zeigt ohne Termin „—“ und „kein Termin“', () => {
    zeige(null);
    expect(kennzahl('Nächste Lagebesprechung')).toHaveTextContent('—kein Termin');
  });

  it('zeigt alle Zeilen der Vorbereitung in ihrer Reihenfolge, ohne Quelle', () => {
    zeige();
    const block = screen.getByRole('region', { name: 'Vorbereitung' });
    expect(block).toHaveTextContent('Stand');
    const titel = within(block)
      .getAllByRole('listitem')
      .map((z) => z.firstElementChild?.textContent);
    expect(titel).toEqual(ZEILEN.map((z) => z.titel));
    expect(block).not.toHaveTextContent('Quelle');
  });

  it('nennt eine gesperrte Quelle mit Grund', () => {
    zeige();
    const z = within(screen.getByRole('region', { name: 'Vorbereitung' }))
      .getAllByRole('listitem')
      .find((l) => l.textContent?.startsWith('Nachforderungen offen'))!;
    expect(z).toHaveTextContent('—nicht freigegeben');
  });

  it('hat keine Bedienung außer der Hülle', () => {
    zeige();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('a')).toBeNull();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Großbild verlassen']);
  });
});
