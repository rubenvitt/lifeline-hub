import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import { renderMitProviders } from '../test/utils';
import Sichtungsboard from './Sichtungsboard';

/**
 * Sichtungsboard (LLH-1332, Spec `sichtungsboard`): eine Spalte je Kategorie, Karten je Person,
 * Folge nach Sichtungszeit, Schleuse unter dem Zeiger.
 */

const basis: Person = {
  id: 1,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: null,
  vorname: null,
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-10-19 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-19 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  versorgung: 'offen',
  aktuelle_sichtung: null,
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
};
const p = (id: number, extra: Partial<Person> = {}): Person => ({
  ...basis,
  id,
  registrier_nr: id,
  ...extra,
});

function zeige(personen: Person[]) {
  return renderMitProviders(
    <Sichtungsboard einsatzId={1} personen={personen} uhsName={() => 'Turnhalle'} />,
  );
}

const spalten = () => screen.getAllByTestId('board-spalte');
const spalte = (sk: string) =>
  screen.getAllByTestId('board-spalte').find((s) => s.dataset.sichtung === sk)!;
const kennungen = (el: HTMLElement) =>
  within(el)
    .queryAllByTestId('board-karte')
    .map((k) => /R-\d+/.exec(k.textContent ?? '')?.[0]);

describe('Sichtungsboard', () => {
  it('steht mit allen Spalten in fester Folge, auch leer (Spec „Leere Kategorie“)', () => {
    zeige([
      p(1, { aktuelle_sichtung: 'sk2', aktuelle_sichtung_at: '2026-10-19 09:10:00' }),
      p(2, { aktuelle_sichtung: 'sk2', aktuelle_sichtung_at: '2026-10-19 09:20:00' }),
    ]);
    expect(spalten().map((s) => s.dataset.sichtung)).toEqual([
      'sk1',
      'sk2',
      'sk3',
      'sk4',
      'tot',
      'unverletzt',
      'ohne',
    ]);
    expect(within(spalte('sk1')).getByTestId('board-zahl')).toHaveTextContent('0');
    expect(within(spalte('sk2')).getByTestId('board-zahl')).toHaveTextContent('2');
    // Zweiter Kanal: der Kopf trägt das Wort, nicht nur die Farbe.
    expect(within(spalte('sk1')).getByRole('heading')).toHaveTextContent('SK I');
  });

  it('die am längsten zurückliegende Sichtung steht oben (Spec „Folge nach Wartezeit“)', () => {
    zeige([
      p(8, { aktuelle_sichtung: 'sk2', aktuelle_sichtung_at: '2026-10-19 09:25:00' }),
      p(9, { aktuelle_sichtung: 'sk2', aktuelle_sichtung_at: '2026-10-19 09:10:00' }),
    ]);
    expect(kennungen(spalte('sk2'))).toEqual(['R-009', 'R-008']);
  });

  it('nennt Kennung, Name, Aufenthalt und Priorität; unterwegs mit Fahrzeug', () => {
    zeige([
      p(11, {
        name: 'Ernst',
        vorname: 'Hans',
        pat_nummer: 'A-17',
        aktuelle_sichtung: 'sk3',
        versorgung: 'unterwegs',
        aktuelle_verbleib_art: 'transport',
        aktueller_verbleib: 'Eigentransport 1/83-1 → KH Mitte',
        transport_prioritaet: 'dringlich',
      }),
      p(12, { aktuelle_sichtung: 'sk3', aktuelle_uhs_id: 3 }),
    ]);
    const karten = within(spalte('sk3')).getAllByTestId('board-karte');
    expect(karten[0]).toHaveTextContent('R-011');
    expect(karten[0]).toHaveTextContent('Ernst, Hans');
    expect(karten[0]).toHaveTextContent('A-17');
    expect(karten[0]).toHaveTextContent('Eigentransport 1/83-1 → KH Mitte');
    expect(karten[0]).toHaveTextContent('dringlich');
    expect(karten[1]).toHaveTextContent('unbekannt');
    expect(karten[1]).toHaveTextContent('UHS Turnhalle');
  });

  it('die Karte führt zur Detailseite', () => {
    zeige([p(4, { aktuelle_sichtung: 'sk1' })]);
    expect(screen.getByRole('link', { name: /R-004/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/personen/4',
    );
  });

  it('hält Spalte und Folge, solange der Zeiger im Board ist (Spec „Neue Sichtung unter dem Zeiger“)', async () => {
    const vorher = [
      p(1, { aktuelle_sichtung: 'sk3', aktuelle_sichtung_at: '2026-10-19 09:10:00' }),
      p(2, { aktuelle_sichtung: 'sk3', aktuelle_sichtung_at: '2026-10-19 09:20:00' }),
    ];
    const { rerender } = zeige(vorher);
    const board = screen.getByTestId('sichtungsboard');
    fireEvent.pointerMove(board, { pointerType: 'mouse' });
    rerender(
      <Sichtungsboard
        einsatzId={1}
        uhsName={() => 'Turnhalle'}
        personen={[
          { ...vorher[0], aktuelle_sichtung: 'sk2' },
          vorher[1],
          p(3, { aktuelle_sichtung: 'sk3', aktuelle_sichtung_at: '2026-10-19 09:00:00' }),
        ]}
      />,
    );
    // R-001 bleibt in SK III stehen, R-003 wartet hinten.
    expect(kennungen(spalte('sk3'))).toEqual(['R-001', 'R-002', 'R-003']);
    expect(kennungen(spalte('sk2'))).toEqual([]);

    fireEvent.pointerLeave(board, { pointerType: 'mouse' });
    await waitFor(() => expect(kennungen(spalte('sk2'))).toEqual(['R-001']));
    expect(kennungen(spalte('sk3'))).toEqual(['R-003', 'R-002']);
  });

  it('die Sichtungsmarke ist mit Schreibrecht der Auslöser der Nachsichtung, sonst Anzeige', () => {
    const rueckmeldung = { beginne: () => {}, melde: () => {}, hold: () => {} };
    const { unmount } = renderMitProviders(
      <Sichtungsboard
        einsatzId={1}
        personen={[p(4, { aktuelle_sichtung: 'sk2' })]}
        uhsName={() => undefined}
        bedienung={{ einsatzId: 1, darfSchreiben: true, rueckmeldung }}
      />,
    );
    expect(screen.getByRole('button', { name: /Sichtung R-004/ })).toBeInTheDocument();
    unmount();
    zeige([p(4, { aktuelle_sichtung: 'sk2' })]);
    expect(screen.queryByRole('button', { name: /Sichtung R-004/ })).toBeNull();
  });
});
