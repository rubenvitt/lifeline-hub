import { createRef } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import Schnellerfassung from './Schnellerfassung';

const einsatz = { id: 7, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige;

function original(): EtbEintragAnzeige {
  return {
    id: 5, lfd_nr: 5, typ: 'meldung', inhalt: 'Original', von: null, an: null,
    meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null, berichtigt_eintrag_id: null,
  };
}

function props(over: Partial<React.ComponentProps<typeof Schnellerfassung>> = {}) {
  return {
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    berichtigungZu: null, onBerichtigungAbbrechen: vi.fn(), bausteine: [] as EtbBaustein[], einsatz, ...over,
  };
}

// ---------------------------------------------------------------------------
// Caret-Ref-Verifikation (kritischer Integrationstest)
// ---------------------------------------------------------------------------

describe('TextAreaRef – Caret-Pfad', () => {
  it('resizableTextArea.textArea ist eine HTMLTextAreaElement-Instanz', () => {
    const ref = createRef<TextAreaRef>();
    renderMitProviders(
      <MarkdownEditor layout="toggle" value="" onChange={() => {}} ref={ref} />,
    );
    expect(ref.current?.resizableTextArea?.textArea).toBeInstanceOf(HTMLTextAreaElement);
  });
});

// ---------------------------------------------------------------------------
// Container-Tests
// ---------------------------------------------------------------------------

describe('Schnellerfassung', () => {
  it('Enter sendet typ=meldung mit Inhalt; Feld danach leer', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    const arg = (p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ typ: 'meldung', inhalt: 'Pumpe läuft' });
    expect(arg.erfasst_lokal_at).toBeTruthy();
    expect(feld).toHaveValue('');
  });

  it('Shift+Enter sendet nicht (Zeilenumbruch)', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Zeile1{Shift>}{Enter}{/Shift}Zeile2');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('/ öffnet Menü; Feld „Von" wird als Chip erfasst und mitgesendet', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage /von');
    await userEvent.click(await screen.findByText('Von'));
    const chipInput = await screen.findByLabelText('Von');
    await userEvent.type(chipInput, 'ELW 1{Enter}');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ von: 'ELW 1' });
  });

  it('Enter bei offenem Menü sendet nicht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage /');
    await screen.findByText('Felder');
    await userEvent.keyboard('{Enter}');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('Berichtigungsmodus sendet typ=berichtigung + berichtigt_eintrag_id', async () => {
    const p = props({ berichtigungZu: original() });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Korrektur{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ typ: 'berichtigung', berichtigt_eintrag_id: 5 });
  });

  it('Baustein über / setzt den Inhalt', async () => {
    const baustein: EtbBaustein = { id: 1, label: 'Bereitstellung', typ: 'meldung', inhalt: 'Bereitstellungsraum bezogen', meldeweg: null, veranlassung: null, sortier: 0 };
    const p = props({ bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/bereit');
    await userEvent.click(await screen.findByText('Bereitstellung'));
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Bereitstellungsraum bezogen'));
  });

  it('zeigt bei Typ „Lage" den Sprung in den strukturierten Lagebericht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    // Standardtyp ist 'meldung' → kein Button
    expect(screen.queryByRole('button', { name: /strukturierten Lagebericht/i })).not.toBeInTheDocument();
    // Typ auf 'Lage' umstellen
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Lage'));
    expect(await screen.findByRole('button', { name: /strukturierten Lagebericht/i })).toBeInTheDocument();
  });
});
