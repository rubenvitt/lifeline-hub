// Die Sprungpalette nach Zeigerart (LFH-982): bei grobem Zeiger Tippwege statt Tastenhinweisen,
// bei feinem alles wie bisher. Szenarien aus
// `openspec/changes/archive/2026-10-06-lfh-982-sprungpalette-beruehrung/specs/sprungpalette/spec.md`.
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { sendeZeigerAenderung, setzeViewportBreite, setzeZeigerGrob } from '../test/viewport';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

// Die Vorschau selbst hat eigene Tests; hier zählt nur, DASS sie steht.
vi.mock('./Vorschau', () => ({
  Vorschau: ({ ziel }: { ziel: { art: string; id: number } }) => (
    <div data-testid="vorschau-inhalt">
      {ziel.art} {ziel.id}
    </div>
  ),
}));

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

function person(ausfuehren = vi.fn()): Befehl {
  return {
    id: 'datensatz:personen:11',
    gruppe: 'datensaetze',
    label: 'Florian Mustermann',
    kontext: 'Personen',
    ziel: '/einsaetze/5/personen/11',
    vorschau: { art: 'person', einsatzId: 5, id: 11 },
    ausfuehren,
  };
}
const modul: Befehl = {
  id: 'modul:etb',
  gruppe: 'module',
  label: 'ETB',
  ziel: '/einsaetze/5/etb',
  ausfuehren: () => {},
};
const filterZuruecksetzen: Befehl = {
  id: 'tastatur:filter-zuruecksetzen',
  gruppe: 'aktionen',
  label: 'Filter zurücksetzen',
  kuerzel: 'Strg + Rücktaste',
  ausfuehren: () => {},
};

function palette(befehle: Befehl[] = [modul, filterZuruecksetzen, person()]) {
  const schliesse = vi.fn();
  renderMitProviders(
    <CommandPalette
      befehle={befehle}
      schliesse={schliesse}
      userAgent={WINDOWS}
      vorschauVerfuegbar
    />,
  );
  return { schliesse, feld: screen.getByRole('combobox') as HTMLInputElement };
}

const fuss = () => document.querySelector('[data-lfh="palette-fuss"]') as HTMLElement;
/** Jede Tastenmarke der Palette ist ein `kbd` (`Tastenkuerzel`). */
const tastenmarken = () =>
  [...document.querySelectorAll('.ant-modal kbd')].map((k) => k.textContent);
const schliessKnopf = () => screen.queryByRole('button', { name: 'Sprungpalette schließen' });
/** Der Chip heißt nach seinem Kurzwort; das Zeichen davor ist für Hilfstechnik verborgen. */
const KURZ = { '>': 'Aktionen', '#': 'ETB', '@': 'Personen & Kräfte' } as const;
const chip = (zeichen: keyof typeof KURZ) => {
  const knopf = screen.getByRole('button', { name: KURZ[zeichen] });
  expect(knopf).toHaveTextContent(zeichen);
  return knopf;
};
const vorschauZiel = (zeile: string) =>
  screen
    .getByRole('option', { name: zeile })
    .querySelector<HTMLElement>('[data-lfh="palette-vorschau-ziel"]')!;

describe('CommandPalette · grober Zeiger (LFH-982)', () => {
  it('trägt im Kopf einen Schließknopf statt der Esc-Marke, und ein Tipp schließt', async () => {
    setzeZeigerGrob(true);
    const { schliesse } = palette();
    const knopf = schliessKnopf();
    expect(knopf).not.toBeNull();
    await userEvent.setup().click(knopf!);
    expect(schliesse).toHaveBeenCalledTimes(1);
    expect(tastenmarken()).not.toContain('Esc');
  });

  it('zeigt keine Tastenmarke: weder in der Fußzeile noch an den Zeilen', async () => {
    setzeZeigerGrob(true);
    const { feld } = palette();
    expect(tastenmarken()).toEqual([]);
    expect(fuss()).not.toHaveTextContent('öffnen');
    expect(fuss()).not.toHaveTextContent('neuer Tab');
    expect(fuss()).not.toHaveTextContent('Vorschau');
    // Gesucht: die Aktionszeile steht, ihr Kürzel nicht.
    await userEvent.setup().type(feld, 'filter');
    expect(screen.getByRole('option', { name: /Filter zurücksetzen/ })).not.toHaveTextContent(
      'Rücktaste',
    );
    expect(tastenmarken()).toEqual([]);
  });

  it('behält das Vorschau-Ziel, aber ohne Tastenhinweis im Titel', async () => {
    setzeZeigerGrob(true);
    const { feld } = palette();
    await userEvent.setup().type(feld, 'florian');
    expect(vorschauZiel('Florian Mustermann')).toHaveAttribute('title', 'Vorschau');
  });

  it('bietet die Präfixe als Chips: ein Tipp setzt das Präfix vor den Begriff und fokussiert', async () => {
    setzeZeigerGrob(true);
    const u = userEvent.setup();
    const { feld } = palette();
    await u.type(feld, 'müller');
    await u.click(chip('@'));
    expect(feld.value).toBe('@müller');
    expect(feld).toHaveFocus();
    expect(chip('@')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('>')).toHaveAttribute('aria-pressed', 'false');
    // Die Modusanzeige im Kopf nennt den Modus.
    expect(document.querySelector('[data-lfh="palette-modus"]')).toHaveTextContent('Nur Personen');
  });

  it('behält beim Chip ein Leerzeichen am Ende des Begriffs, damit weitergetippt werden kann', async () => {
    setzeZeigerGrob(true);
    const u = userEvent.setup();
    const { feld } = palette();
    await u.type(feld, 'florian ');
    await u.click(chip('@'));
    await u.type(feld, 'm');
    expect(feld.value).toBe('@florian m');
  });

  it('lässt dem Suchfeld beim Tipp auf einen Chip den Fokus (kein Zuklappen der Bildschirmtastatur)', () => {
    setzeZeigerGrob(true);
    palette();
    // `false` heißt: `preventDefault` gerufen, der Browser verschiebt den Fokus nicht.
    expect(fireEvent.mouseDown(chip('#'))).toBe(false);
  });

  it('ersetzt mit einem Chip ein anderes Präfix', async () => {
    setzeZeigerGrob(true);
    const u = userEvent.setup();
    const { feld } = palette();
    await u.type(feld, '>spei');
    await u.click(chip('#'));
    expect(feld.value).toBe('#spei');
  });

  it('nimmt mit dem gedrückten Chip das Präfix wieder weg', async () => {
    setzeZeigerGrob(true);
    const u = userEvent.setup();
    const { feld } = palette();
    await u.type(feld, '#42');
    expect(chip('#')).toHaveAttribute('aria-pressed', 'true');
    await u.click(chip('#'));
    expect(feld.value).toBe('42');
    expect(chip('#')).toHaveAttribute('aria-pressed', 'false');
  });

  it('nennt am Chip das Kurzwort als Text, ohne erklärenden Titel (LFH-1078)', () => {
    setzeZeigerGrob(true);
    palette();
    expect(chip('>')).not.toHaveAttribute('title');
    expect(chip('>')).toHaveTextContent('Aktionen');
  });

  it('öffnet aus der Vorschau mit dem Knopf „Öffnen“ und schließt', async () => {
    setzeZeigerGrob(true);
    const u = userEvent.setup();
    const aus = vi.fn();
    const { feld, schliesse } = palette([person(aus)]);
    await u.type(feld, 'florian');
    fireEvent.click(vorschauZiel('Florian Mustermann'));
    expect(screen.getByTestId('vorschau-inhalt')).toBeInTheDocument();
    expect(tastenmarken()).toEqual([]);
    expect(document.querySelector('[data-lfh="palette-leerzustand"]')).not.toHaveTextContent(
      'Escape',
    );
    await u.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(aus).toHaveBeenCalledTimes(1);
    expect(aus).toHaveBeenCalledWith();
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('richtet sich nach der Zeigerart, nicht nach der Breite: Tablet quer bekommt die Tippwege', () => {
    setzeViewportBreite(1180);
    setzeZeigerGrob(true);
    palette();
    expect(schliessKnopf()).not.toBeNull();
    expect(tastenmarken()).toEqual([]);
  });
});

describe('CommandPalette · feiner Zeiger (LFH-982, Gegenfall)', () => {
  it('trägt die Esc-Marke, alle Tastenhinweise und keinen Tippweg', async () => {
    const { feld } = palette();
    expect(schliessKnopf()).toBeNull();
    expect(tastenmarken()).toContain('Esc');
    expect(fuss()).toHaveTextContent('öffnen');
    expect(fuss()).toHaveTextContent('neuer Tab');
    expect(fuss()).toHaveTextContent('Vorschau');
    expect(screen.queryByRole('button', { name: 'Aktionen' })).toBeNull();
    await userEvent.setup().type(feld, 'filter');
    expect(screen.getByRole('option', { name: /Filter zurücksetzen/ })).toHaveTextContent(
      'Strg + Rücktaste',
    );
  });

  it('behält am schmalen Fenster die Tastenhinweise (Fükw mit schmalem Fenster)', () => {
    setzeViewportBreite(390);
    palette();
    expect(schliessKnopf()).toBeNull();
    expect(tastenmarken()).toContain('Esc');
    expect(fuss()).toHaveTextContent('neuer Tab');
  });

  it('zeigt in der Vorschau keinen Knopf „Öffnen“, sondern die Tastenwege', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person()]);
    await u.type(feld, 'florian');
    fireEvent.click(vorschauZiel('Florian Mustermann'));
    expect(screen.queryByRole('button', { name: 'Öffnen' })).toBeNull();
    expect(fuss()).toHaveTextContent('zurück');
  });
});

describe('CommandPalette · Wechsel der Zeigerart bei offener Palette (LFH-982)', () => {
  it('folgt einem Gerätewechsel ohne Neuöffnen', () => {
    palette();
    expect(schliessKnopf()).toBeNull();
    act(() => {
      sendeZeigerAenderung(true);
    });
    expect(schliessKnopf()).not.toBeNull();
    expect(tastenmarken()).toEqual([]);
    act(() => {
      sendeZeigerAenderung(false);
    });
    expect(schliessKnopf()).toBeNull();
    expect(tastenmarken()).toContain('Esc');
  });
});
