import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import Schnellerfassung from './Schnellerfassung';

function original(): EtbEintragAnzeige {
  return {
    id: 5, lfd_nr: 5, typ: 'meldung', inhalt: 'Original', von: null, an: null,
    meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null, berichtigt_eintrag_id: null,
  };
}

describe('Schnellerfassung', () => {
  it('sendet typ=meldung mit Inhalt und erfasst_lokal_at', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung
        erfassen={erfassen}
        berichtigungZu={null}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Pumpe läuft');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    const arg = erfassen.mock.calls[0][0];
    expect(arg.typ).toBe('meldung');
    expect(arg.inhalt).toBe('Pumpe läuft');
    expect(arg.erfasst_lokal_at).toBeTruthy();
    expect(arg.berichtigt_eintrag_id).toBeUndefined();
  });

  it('zeigt bei Typ „Lage" den Sprung in den strukturierten Lagebericht', async () => {
    renderMitProviders(
      <Schnellerfassung
        erfassen={vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue()}
        berichtigungZu={null}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ id: 7, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    // Standardtyp ist 'meldung' → kein Button
    expect(screen.queryByRole('button', { name: /strukturierten Lagebericht/i })).not.toBeInTheDocument();
    // Typ auf 'Lage' umstellen
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Lage'));
    expect(await screen.findByRole('button', { name: /strukturierten Lagebericht/i })).toBeInTheDocument();
  });

  it('sendet im Berichtigungsmodus typ=berichtigung mit berichtigt_eintrag_id', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung
        erfassen={erfassen}
        berichtigungZu={original()}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Korrektur');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    const arg = erfassen.mock.calls[0][0];
    expect(arg.typ).toBe('berichtigung');
    expect(arg.berichtigt_eintrag_id).toBe(5);
  });

  it('MarkdownEditor: Erfassen übermittelt getippten Inhalt korrekt', async () => {
    // Belegt, dass der MarkdownEditor-Umschalter den Submit-Flow nicht zerstört.
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung
        erfassen={erfassen}
        berichtigungZu={null}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Testeintrag Markdown');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    expect(erfassen.mock.calls[0][0].inhalt).toBe('Testeintrag Markdown');
  });

  it('MarkdownEditor: Vorschau-Tab zeigt getippten Markdown formatiert', async () => {
    const { container } = renderMitProviders(
      <Schnellerfassung
        erfassen={vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue()}
        berichtigungZu={null}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[]}
        einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    // Schreiben-Tab ist aktiv → ins Textfeld tippen
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), '**fett**');
    // Auf Vorschau umschalten
    await userEvent.click(screen.getByRole('tab', { name: /vorschau/i }));
    // Markdown muss als formatiertes HTML erscheinen
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  it('MarkdownEditor: BausteinPicker setzt Inhalt über setFieldsValue, Schreiben-Feld zeigt ihn', async () => {
    const baustein: EtbBaustein = {
      id: 1,
      label: 'Testbaustein',
      typ: 'meldung',
      inhalt: 'Vorausgefüllter Inhalt',
      meldeweg: null,
      veranlassung: null,
      sortier: 0,
    };
    renderMitProviders(
      <Schnellerfassung
        erfassen={vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue()}
        berichtigungZu={null}
        onBerichtigungAbbrechen={vi.fn()}
        bausteine={[baustein]}
        einsatz={{ id: 1, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
      />,
    );
    // BausteinPicker-Select: antd rendert zwei comboboxen — BausteinPicker und Typ-Select.
    // Der BausteinPicker hat kein festes id="typ", daher den combobox ohne id="typ" nehmen.
    const comboboxen = screen.getAllByRole('combobox');
    const bausteinCombobox = comboboxen.find((el) => el.id !== 'typ')!;
    await userEvent.click(bausteinCombobox);
    await userEvent.click(await screen.findByText('Testbaustein'));
    // Der über setFieldsValue gesetzte Inhalt muss im Schreiben-Textfeld erscheinen
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Inhalt …')).toHaveValue('Vorausgefüllter Inhalt'),
    );
  });
});
