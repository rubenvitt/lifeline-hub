import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import AuftragFormular from './AuftragFormular';

// Katalog und Besetzung stehen fest, statt über das Netz zu kommen (LFH-549).
vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

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

describe('AuftragFormular — Funktionskatalog (LFH-549)', () => {
  it('macht aus der Wahl „S3 – Einsatz“ einen Katalogempfänger', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen, einsatzId: 7 });

    await userEvent.click(screen.getByLabelText('Empfänger'));
    await userEvent.click(await screen.findByTitle('S3 – Einsatz'));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({ empfaenger: [{ empfaenger_typ: 'funktion', funktion: 's3' }] }),
    );
  });

  it('zeigt die Besetzung im Vorschlag', async () => {
    rendern({ einsatzId: 7 });
    await userEvent.click(screen.getByLabelText('Empfänger'));
    expect(await screen.findByTitle('S2 – Lage (Müller)')).toBeInTheDocument();
  });

  it('lässt getipptes „S3“ + Enter Freitext bleiben, auch mit Katalog', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen, einsatzId: 7 });

    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'S3' }],
      }),
    );
  });

  it('bietet „Fachberater: <Tipptext>“ als ausdrückliche Wahl an', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen, einsatzId: 7 });

    await userEvent.type(screen.getByLabelText('Empfänger'), 'THW');
    await userEvent.click(await screen.findByTitle('Fachberater: THW'));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Beraten');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger: [{ empfaenger_typ: 'funktion', funktion: 'fachberater', funktion_text: 'THW' }],
      }),
    );
  });
});

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. */
describe('AuftragFormular — Frist und Erteilung in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('„erteilt am“ zeigt jetzt in Berlin, eine Frist 13:00 geht als 11:00 UTC hinaus', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'));
    try {
      const onAnlegen = vi.fn();
      renderMitProviders(
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <AuftragFormular
            card={false}
            senden={false}
            abschnitte={[{ id: 1, name: 'Abschnitt Nord' }]}
            einheiten={[{ id: 2, name: 'LZ 1' }]}
            onAnlegen={onAnlegen}
          />
        </AnzeigeKonventionenProvider>,
      );
      await userEvent.click(screen.getByText(/Befehlsschema/));
      expect(
        await screen.findByRole('textbox', { name: 'Erteilt am (mündlich/per Funk – optional)' }),
      ).toHaveValue('2026-09-24 10:00');
      await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
      await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
      const frist = screen.getByRole('textbox', { name: 'Frist (Quittung/Vollzug)' });
      await userEvent.click(frist);
      await userEvent.type(frist, '2026-09-24 13:00');
      await userEvent.keyboard('{Enter}');
      await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
      expect(onAnlegen).toHaveBeenCalledWith(
        expect.objectContaining({
          frist_at: '2026-09-24 11:00:00',
          erteilt_at: '2026-09-24 08:00:00',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
