import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import AuftragFormular from './AuftragFormular';

/** Die sieben SKK-Schemafelder hinter dem Collapse. */
const SKK = [
  'Absicht / Ziel',
  'Lage',
  'Ort / Wo',
  'Zeit / Wann',
  'Mittel / Womit',
  'Verbindung / Meldewege',
  'Sicherheit / Besonderes',
];

function felderZaehlen(): number {
  return screen.getAllByRole('textbox').length + screen.getAllByRole('combobox').length;
}

function rendern(over: Partial<Parameters<typeof AuftragFormular>[0]> = {}) {
  return renderMitProviders(
    <AuftragFormular
      card={false}
      senden={false}
      abschnitte={[{ id: 1, name: 'Abschnitt Nord' }]}
      einheiten={[{ id: 2, name: 'LZ 1' }]}
      onAnlegen={vi.fn()}
      {...over}
    />,
  );
}

describe('AuftragFormular — Feldbudget (LFH-343 · C8, Befund H49)', () => {
  /**
   * „≤ 4" allein ist nicht widerlegbar (ohne `forceRender` rendert der Collapse erst beim
   * Aufklappen); erst das Paar — Zahl klein UND Aufklappen bringt die Felder — trägt.
   */
  it('zeigt im Ausgangszustand höchstens vier Felder', () => {
    rendern();
    expect(felderZaehlen()).toBeLessThanOrEqual(4);
    for (const feld of SKK) expect(screen.queryByLabelText(feld)).toBeNull();
  });

  it('holt die sieben Schemafelder erst beim Aufklappen ins DOM', async () => {
    rendern();
    const vorher = felderZaehlen();

    await userEvent.click(screen.getByText(/Befehlsschema/));

    for (const feld of SKK) expect(screen.getByLabelText(feld)).toBeInTheDocument();
    expect(felderZaehlen()).toBeGreaterThan(vorher);
  });

  /**
   * Der Empfänger ist PFLICHT und darf nicht hinter den Collapse: strukturierte Ziele und freie
   * Funktionstexte laufen durch EIN Feld.
   */
  it('nimmt freie Funktionstexte über dasselbe Feld wie die strukturierten Ziele', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen });

    const empfaenger = screen.getByLabelText('Empfänger');
    await userEvent.type(empfaenger, 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        auftrag_text: 'Erkunden',
        empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'S3' }],
      }),
    );
  });

  it('erkennt einen gewählten Abschnitt als strukturiertes Ziel', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen });

    await userEvent.click(screen.getByLabelText('Empfänger'));
    await userEvent.click(await screen.findByTitle('Abschnitt Nord'));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    // Der Präfix `abschnitt:` unterscheidet die beiden Sorten im selben Feld.
    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger: [{ empfaenger_typ: 'abschnitt', abschnitt_id: 1 }],
      }),
    );
  });
});
