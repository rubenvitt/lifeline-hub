import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VERBINDUNGEN_MAX, VERBINDUNG_TEXT_MAX } from '../api/eingabegrenzen';
import type { KommunikationsVerbindung } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { verschachtelteZiele } from '../test/verschachtelteZiele';
import { VerbindungenAngabe } from './VerbindungenFeld';

const vb = (
  id: number,
  mittel: KommunikationsVerbindung['mittel'],
  wert: string,
  hinweis: string | null = null,
): KommunikationsVerbindung => ({ id, mittel, wert, hinweis });

const ETIKETT = 'Telefon und weitere Verbindungen';

function zeige(verbindungen: KommunikationsVerbindung[], darfSchreiben = true) {
  const onSpeichern = vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <VerbindungenAngabe
      etikett={ETIKETT}
      verbindungen={verbindungen}
      darfSchreiben={darfSchreiben}
      onSpeichern={onSpeichern}
    />,
  );
  return { onSpeichern };
}

describe('VerbindungenAngabe (LLH-1134)', () => {
  it('liest: Mittel, Wert als tel:/mailto:-Verweis, Hinweis', () => {
    zeige([vb(1, 'mobil', '+49 170 1234', 'nur tagsüber'), vb(2, 'email', 'a@b.de')], false);
    expect(screen.getByRole('link', { name: '+49 170 1234' })).toHaveAttribute(
      'href',
      'tel:+491701234',
    );
    expect(screen.getByRole('link', { name: 'a@b.de' })).toHaveAttribute('href', 'mailto:a@b.de');
    // Ein `<a>` erbt keine Steuerhöhe: der Verweis trägt den Boden der Staffel (LLH-1426).
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveStyle({ display: 'inline-flex' });
      expect(link.style.minHeight).toMatch(/^\d+px$/);
    }
    expect(screen.getByText('nur tagsüber')).toBeInTheDocument();
    expect(screen.getByText('Mobil')).toBeInTheDocument();
  });

  // LLH-1426: die Nummer stand als Link im Wertknopf der Angabe. Ein Klick darauf öffnete die
  // Bearbeitung, und ein Screenreader fand einen Link in einem Button.
  it('mit Schreibrecht: ein Klick auf die Nummer wählt, die Bearbeitung öffnet „Bearbeiten“ daneben', async () => {
    const { container } = renderMitProviders(
      <VerbindungenAngabe
        etikett={ETIKETT}
        verbindungen={[vb(1, 'mobil', '+49 170 1234'), vb(2, 'email', 'a@b.de')]}
        darfSchreiben
        onSpeichern={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(verschachtelteZiele(container)).toEqual([]);

    const verhindert: boolean[] = [];
    const lauscher = (e: MouseEvent) => {
      verhindert.push(e.defaultPrevented);
      // jsdom navigiert nicht; ohne das meldete es „Not implemented: navigation“.
      e.preventDefault();
    };
    window.addEventListener('click', lauscher);
    try {
      await userEvent.click(screen.getByRole('link', { name: '+49 170 1234' }));
      await userEvent.click(screen.getByRole('link', { name: 'a@b.de' }));
    } finally {
      window.removeEventListener('click', lauscher);
    }
    expect(verhindert).toEqual([false, false]);
    expect(screen.queryByRole('group', { name: ETIKETT })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: `${ETIKETT} bearbeiten` }));
    expect(screen.getByRole('group', { name: ETIKETT })).toBeInTheDocument();
  });

  it('ohne Schreibrecht und leer: „—“', () => {
    zeige([], false);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('legt eine Verbindung an: Mittel, Nummer und Hinweis gehen als Ersatzliste hinaus', async () => {
    const user = userEvent.setup();
    const { onSpeichern } = zeige([]);
    await user.click(screen.getByRole('button', { name: `${ETIKETT} eintragen` }));
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen' }));
    await user.type(screen.getByRole('textbox', { name: 'Nummer oder Adresse 1' }), ' 0511 22 ');
    await user.type(screen.getByRole('textbox', { name: 'Hinweis 1' }), 'Lagedienst');
    await user.click(screen.getByRole('button', { name: `${ETIKETT} speichern` }));
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith([
        { mittel: 'mobil', wert: '0511 22', hinweis: 'Lagedienst' },
      ]),
    );
  });

  it('entfernt eine Verbindung; leere Zeilen fallen beim Speichern weg', async () => {
    const user = userEvent.setup();
    const { onSpeichern } = zeige([vb(1, 'mobil', '0170 1'), vb(2, 'fax', '0511 9')]);
    await user.click(screen.getByRole('button', { name: `${ETIKETT} bearbeiten` }));
    await user.click(screen.getByRole('button', { name: 'Verbindung 1 entfernen' }));
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen' }));
    await user.click(screen.getByRole('button', { name: `${ETIKETT} speichern` }));
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith([{ mittel: 'fax', wert: '0511 9' }]),
    );
  });

  it('unverändert: kein Senden', async () => {
    const user = userEvent.setup();
    const { onSpeichern } = zeige([vb(1, 'mobil', '0170 1')]);
    await user.click(screen.getByRole('button', { name: `${ETIKETT} bearbeiten` }));
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen' }));
    await user.click(screen.getByRole('button', { name: `${ETIKETT} speichern` }));
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('ein Hinweis ohne Nummer wird nicht gesendet, der Grund steht am Feld', async () => {
    const user = userEvent.setup();
    const { onSpeichern } = zeige([]);
    await user.click(screen.getByRole('button', { name: `${ETIKETT} eintragen` }));
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen' }));
    await user.type(screen.getByRole('textbox', { name: 'Hinweis 1' }), 'nur tagsüber');
    await user.click(screen.getByRole('button', { name: `${ETIKETT} speichern` }));
    expect(await screen.findByText('Verbindung 1: Nummer oder Adresse fehlt')).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it(`höchstens ${VERBINDUNGEN_MAX} Verbindungen, Wert höchstens ${VERBINDUNG_TEXT_MAX} Zeichen`, async () => {
    const user = userEvent.setup();
    zeige(Array.from({ length: VERBINDUNGEN_MAX }, (_, i) => vb(i + 1, 'mobil', `0170 ${i}`)));
    await user.click(screen.getByRole('button', { name: `${ETIKETT} bearbeiten` }));
    expect(screen.getByRole('button', { name: 'Verbindung hinzufügen' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Nummer oder Adresse 1' })).toHaveAttribute(
      'maxlength',
      String(VERBINDUNG_TEXT_MAX),
    );
    const gruppe = screen.getByRole('group', { name: ETIKETT });
    expect(within(gruppe).getAllByRole('combobox')).toHaveLength(VERBINDUNGEN_MAX);
  });
});
