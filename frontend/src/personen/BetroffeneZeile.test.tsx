import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSON_NAME_MAX } from '../api/eingabegrenzen';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';
import BetroffeneZeile from './BetroffeneZeile';

/**
 * Der Kürzel-Hinweis der Erfassungszeile (LFH-963, design.md D6): ab `md` steht er, solange das
 * leere Feld den Fokus hat (LFH-1078: sonst reichen Platzhalter und „erkannt:“-Marken), unter
 * `md` klappt er hinter „Kürzel anzeigen“ ein — drei Zeilen Kürzel kosteten am Handy den Platz
 * der ersten Person. Die Breiten als Literale (390 Handschirm, 1180 Tablet quer).
 */

afterEach(() => setzeViewportZurueck());

function zeige() {
  return renderMitProviders(<BetroffeneZeile uhsListe={[]} onErfassen={vi.fn()} />);
}

describe('BetroffeneZeile — Kürzel-Hinweis', () => {
  it('steht ab md nur bei Fokus auf dem Feld, ohne Umschalter und ohne Enter-Hinweis', async () => {
    setzeViewportBreite(1180);
    zeige();
    const kuerzel = () => screen.getByText('m/w/d + Alter').parentElement!;
    const feld = screen.getByRole('textbox', { name: 'Kurzeingabe Person' });
    // Ohne Fokus durchsichtig, aber im Baum: die Zeile behält ihre Höhe, die Beschreibung bleibt.
    expect(kuerzel()).toHaveStyle({ opacity: '0' });
    expect(feld).toHaveAccessibleDescription(expect.stringContaining('m/w/d + Alter'));
    await userEvent.click(feld);
    expect(kuerzel()).not.toHaveStyle({ opacity: '0' });
    await userEvent.tab();
    expect(kuerzel()).toHaveStyle({ opacity: '0' });
    expect(screen.queryByRole('button', { name: 'Kürzel anzeigen' })).not.toBeInTheDocument();
    expect(screen.queryByText(/erfassen & nächste/)).not.toBeInTheDocument();
  });

  it('klappt unter md ein und auf Wunsch wieder auf — derselbe Knopf, der Fokus bleibt', async () => {
    setzeViewportBreite(390);
    zeige();
    const kuerzel = () => screen.getByText('m/w/d + Alter').parentElement!;
    // Eingeklappt: aus dem Bild (Vorleser-Stil), aber weiter die Beschreibung des Felds.
    expect(kuerzel()).toHaveStyle({ position: 'absolute' });
    expect(screen.getByRole('textbox', { name: 'Kurzeingabe Person' })).toHaveAccessibleDescription(
      expect.stringContaining('m/w/d + Alter'),
    );
    const knopf = screen.getByRole('button', { name: 'Kürzel anzeigen' });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(knopf);
    expect(kuerzel()).not.toHaveStyle({ position: 'absolute' });
    expect(knopf).toHaveAccessibleName('Kürzel ausblenden');
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(knopf).toHaveFocus();
    // Der Knopf selbst gehört nicht zur Feldbeschreibung.
    expect(
      screen.getByRole('textbox', { name: 'Kurzeingabe Person' }),
    ).not.toHaveAccessibleDescription(expect.stringContaining('Kürzel ausblenden'));
    await userEvent.click(knopf);
    expect(kuerzel()).toHaveStyle({ position: 'absolute' });
  });
});

/**
 * Grenze des Namens in der Schnellerfassung (LLH-1329): ab 80 % steht der Zähler an der Marke,
 * darüber sendet die Zeile nicht, nennt den Grund und behält den Wortlaut. Mutationsprobe: den
 * Zähler an der Namensmarke entfernt → „201 / 200 · zu lang“ fehlt und der Fall wird rot.
 */
describe('BetroffeneZeile — Grenze des Namens (LLH-1329)', () => {
  it('zählt ab 80 %, sperrt über der Grenze und kürzt nicht', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<BetroffeneZeile uhsListe={[]} onErfassen={onErfassen} />);
    const feld = screen.getByRole('textbox', { name: 'Kurzeingabe Person' });

    fireEvent.change(feld, { target: { value: 'x'.repeat(PERSON_NAME_MAX * 0.8 - 1) } });
    expect(screen.queryByText(/ \/ 200/)).toBeNull();

    const lang = 'x'.repeat(PERSON_NAME_MAX + 1);
    fireEvent.change(feld, { target: { value: `${lang} sk2` } });
    expect(screen.getByText('201 / 200 · zu lang')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Person erfassen' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nicht erfasst: Name darf höchstens 200 Zeichen lang sein',
    );
    expect(onErfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue(`${lang} sk2`);
  });
});
