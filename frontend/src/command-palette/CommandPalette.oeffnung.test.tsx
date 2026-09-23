// frontend/src/command-palette/CommandPalette.oeffnung.test.tsx
//
// Öffnungswege der Sprungpalette (LFH-645, Raycast-Muster): Strg/⌘+↵ öffnet das Ziel in einem
// neuen Tab, → zeigt eine Vorschau IN der Palette. Die Szenarien folgen
// `openspec/changes/lfh-645-palette-vorschau-neuer-tab/specs/sprungpalette/spec.md`.
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

// Die Vorschau selbst hat ihren eigenen Test (`Vorschau.test.tsx`, `PersonVorschau.test.tsx`).
// Hier zählt allein, DASS und WESSEN Vorschau erscheint — ohne Netz.
vi.mock('./Vorschau', () => ({
  Vorschau: ({ ziel }: { ziel: { art: string; id: number } }) => (
    <div data-testid="vorschau-inhalt">
      {ziel.art} {ziel.id}
    </div>
  ),
}));

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)';

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
function modul(ausfuehren = vi.fn()): Befehl {
  return {
    id: 'modul:etb',
    gruppe: 'module',
    label: 'ETB',
    ziel: '/einsaetze/5/etb',
    ausfuehren,
  };
}
function speichern(ausfuehren = vi.fn()): Befehl {
  return { id: 'tastatur:speichern', gruppe: 'aktionen', label: 'Speichern', ausfuehren };
}

function palette(befehle: Befehl[], extra: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const schliesse = vi.fn();
  renderMitProviders(
    <CommandPalette befehle={befehle} schliesse={schliesse} userAgent={WINDOWS} {...extra} />,
  );
  return { schliesse, feld: screen.getByRole('combobox') as HTMLInputElement };
}

const fuss = () => document.querySelector('[data-lfh="palette-fuss"]') as HTMLElement;
const vorschauRegion = () => screen.queryByRole('region', { name: /^Vorschau/ });

describe('CommandPalette · Strg/⌘+↵ neuer Tab (LFH-645)', () => {
  it('öffnet eine Zeile mit Ziel im neuen Tab und schliesst', () => {
    const aus = vi.fn();
    const { schliesse, feld } = palette([person(aus)]);
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true });
    expect(aus).toHaveBeenCalledWith('neuerTab');
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('nimmt unter macOS ⌘ statt Strg', () => {
    const aus = vi.fn();
    const { feld } = palette([person(aus)], { userAgent: MAC });
    fireEvent.keyDown(feld, { key: 'Enter', metaKey: true });
    expect(aus).toHaveBeenCalledWith('neuerTab');
  });

  it('bleibt auf einer Zeile OHNE Ziel wirkungslos — kein Rückfall auf ↵', () => {
    const aus = vi.fn();
    const { schliesse, feld } = palette([speichern(aus)]);
    // Dass die Seite UNTER der Palette dabei nicht speichert, belegt der Provider-Test — dort
    // sitzt der Riegel (`CommandPaletteProvider.oeffnung.test.tsx`).
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true });
    expect(aus).not.toHaveBeenCalled();
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('blankes ↵ öffnet weiter im aktuellen Tab', () => {
    const aus = vi.fn();
    const { feld } = palette([person(aus)]);
    fireEvent.keyDown(feld, { key: 'Enter' });
    expect(aus).toHaveBeenCalledTimes(1);
    expect(aus).not.toHaveBeenCalledWith('neuerTab');
  });

  it('tut während einer IME-Komposition nichts', () => {
    const aus = vi.fn();
    const { schliesse, feld } = palette([person(aus)]);
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(aus).not.toHaveBeenCalled();
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('Strg/⌘+Klick auf eine Zeile öffnet ebenfalls im neuen Tab', () => {
    const aus = vi.fn();
    palette([person(aus)]);
    fireEvent.click(screen.getByRole('option', { name: 'Florian Mustermann' }), { ctrlKey: true });
    expect(aus).toHaveBeenCalledWith('neuerTab');
  });

  it('ein gewöhnlicher Klick öffnet im aktuellen Tab', () => {
    const aus = vi.fn();
    palette([person(aus)]);
    fireEvent.click(screen.getByRole('option', { name: 'Florian Mustermann' }));
    expect(aus).toHaveBeenCalledTimes(1);
    expect(aus).not.toHaveBeenCalledWith('neuerTab');
  });
});

describe('CommandPalette · → Vorschau (LFH-645)', () => {
  it('zeigt am Textende die Vorschau der markierten Zeile anstelle der Treffer', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person(), modul()]);
    await u.type(feld, 'flor');
    await u.keyboard('{ArrowRight}');
    expect(vorschauRegion()).toHaveAccessibleName('Vorschau: Florian Mustermann');
    expect(screen.getByTestId('vorschau-inhalt')).toHaveTextContent('person 11');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(feld).toHaveFocus();
    expect(feld).toHaveAttribute('aria-expanded', 'false');
    expect(feld).not.toHaveAttribute('aria-activedescendant');
  });

  it('bewegt mitten im Wort den Cursor und öffnet keine Vorschau', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person()]);
    await u.type(feld, 'flor');
    await u.keyboard('{ArrowLeft}{ArrowRight}');
    expect(vorschauRegion()).toBeNull();
    expect(feld.selectionStart).toBe(4);
  });

  it('bleibt bei einer Zeile ohne Vorschau in der Trefferliste', async () => {
    const u = userEvent.setup();
    palette([modul()]);
    await u.keyboard('{ArrowRight}');
    expect(vorschauRegion()).toBeNull();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Esc führt zurück — Begriff und Markierung bleiben, die Palette bleibt offen', async () => {
    const u = userEvent.setup();
    // Startansicht: `aktionen` steht vor `datensaetze`. Die Person ist also die ZWEITE Zeile —
    // die Rückkehr muss genau sie wieder markieren, nicht auf die erste zurückfallen.
    const { schliesse, feld } = palette([speichern(), person()]);
    await u.keyboard('{ArrowDown}{ArrowRight}');
    expect(vorschauRegion()).not.toBeNull();

    const nichtVerhindert = fireEvent.keyDown(feld, { key: 'Escape' });
    // Ohne `preventDefault` schlösse der globale `verwerfen` die Palette gleich mit.
    expect(nichtVerhindert).toBe(false);
    expect(vorschauRegion()).toBeNull();
    expect(screen.getByRole('option', { name: 'Florian Mustermann' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('der Suchbegriff überlebt den Weg in die Vorschau und zurück', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person()]);
    await u.type(feld, 'flor');
    await u.keyboard('{ArrowRight}');
    expect(vorschauRegion()).not.toBeNull();
    fireEvent.keyDown(feld, { key: 'Escape' });
    expect(feld).toHaveValue('flor');
    expect(screen.getByRole('option', { name: 'Florian Mustermann' })).toBeInTheDocument();
  });

  it('Esc führt auch zurück, wenn der Fokus auf „Zurück" steht (Review-Befund)', async () => {
    const u = userEvent.setup();
    const { schliesse } = palette([person()]);
    await u.keyboard('{ArrowRight}');
    await u.tab();
    const zurueck = screen.getByRole('button', { name: /Zurück/ });
    expect(zurueck).toHaveFocus();
    // Ohne Riegel an der Palettenwurzel sähe NUR der globale Dispatcher diese Taste — und
    // schlösse die ganze Palette, statt eine Ebene zurückzugehen.
    const nichtVerhindert = fireEvent.keyDown(zurueck, { key: 'Escape' });
    expect(nichtVerhindert).toBe(false);
    expect(vorschauRegion()).toBeNull();
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('scrollt die markierte Zeile nach der Rückkehr wieder in den Blick (Review-Befund)', async () => {
    // Die Liste hängt in der Vorschau aus und kommt mit `scrollTop` 0 zurück. `aktiv` ändert
    // sich beim Rückweg nicht — hinge das Einscrollen nur daran, stünde die Markierung
    // ausserhalb des Blicks. jsdom rechnet kein Layout; geprüft wird der Aufruf am richtigen
    // Knoten, der Blick selbst im Browser.
    const u = userEvent.setup();
    const original = Element.prototype.scrollIntoView;
    const scrolle = vi.fn();
    Element.prototype.scrollIntoView = scrolle;
    try {
      palette([speichern(), person()]);
      await u.keyboard('{ArrowDown}{ArrowRight}');
      scrolle.mockClear();
      await u.keyboard('{Escape}');
      // `waitFor`: das Einscrollen läuft im Effekt nach dem Rückweg. Unter CI-Last kam dieser
      // Effekt erst nach dem `keyboard`-Await an (gemessen in PR #122: 1 von 4 Shards rot,
      // lokal 5/5 grün) — die Aussage ist „wird eingescrollt", nicht „im selben Tick".
      await waitFor(() => {
        expect(scrolle).toHaveBeenCalled();
        expect(scrolle.mock.contexts[scrolle.mock.contexts.length - 1]).toBe(
          screen.getByRole('option', { name: 'Florian Mustermann' }),
        );
      });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('← führt ebenfalls zurück', async () => {
    const u = userEvent.setup();
    palette([person()]);
    await u.keyboard('{ArrowRight}');
    expect(vorschauRegion()).not.toBeNull();
    await u.keyboard('{ArrowLeft}');
    expect(vorschauRegion()).toBeNull();
  });

  it('der Knopf „Zurück" führt zurück und gibt den Fokus ans Suchfeld', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person()]);
    await u.keyboard('{ArrowRight}');
    await u.click(screen.getByRole('button', { name: /Zurück/ }));
    expect(vorschauRegion()).toBeNull();
    expect(feld).toHaveFocus();
  });

  it('↵ öffnet den gezeigten Datensatz', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const { schliesse } = palette([person(aus)]);
    await u.keyboard('{ArrowRight}');
    expect(vorschauRegion()).not.toBeNull();
    await u.keyboard('{Enter}');
    expect(aus).toHaveBeenCalledTimes(1);
    expect(aus).not.toHaveBeenCalledWith('neuerTab');
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('Strg+↵ öffnet den gezeigten Datensatz im neuen Tab', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const { feld } = palette([person(aus)]);
    await u.keyboard('{ArrowRight}');
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true });
    expect(aus).toHaveBeenCalledWith('neuerTab');
  });

  it('Weitertippen verlässt die Vorschau und zeigt die Treffer zum neuen Begriff', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person(), modul()]);
    await u.keyboard('{ArrowRight}');
    expect(vorschauRegion()).not.toBeNull();
    await u.type(feld, 'etb');
    expect(vorschauRegion()).toBeNull();
    expect(screen.getByRole('option', { name: 'ETB' })).toBeInTheDocument();
  });

  it('Pfeil hoch/runter verschieben in der Vorschau keine unsichtbare Markierung', async () => {
    const u = userEvent.setup();
    const { feld } = palette([person(), modul()]);
    await u.keyboard('{ArrowRight}{ArrowDown}');
    fireEvent.keyDown(feld, { key: 'Escape' });
    expect(screen.getByRole('option', { name: 'Florian Mustermann' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('CommandPalette · Fußzeile und Zeilenmarke (LFH-645)', () => {
  it('nennt den neuen Tab mit dem Kürzel der Plattform', () => {
    palette([modul()]);
    expect(fuss()).toHaveTextContent('neuer Tab');
    expect(screen.getByText('Strg + ↵', { selector: 'kbd' })).toBeInTheDocument();
  });

  it('nimmt unter macOS das ⌘-Zeichen', () => {
    palette([modul()], { userAgent: MAC });
    expect(screen.getByText('⌘ ↵', { selector: 'kbd' })).toBeInTheDocument();
    expect(screen.queryByText('Strg + ↵', { selector: 'kbd' })).not.toBeInTheDocument();
  });

  it('nennt die Vorschau nur, wo es sie geben kann', () => {
    palette([modul()], { vorschauVerfuegbar: true });
    expect(fuss()).toHaveTextContent('Vorschau');
  });

  it('ohne Einsatz kein Vorschauhinweis — und nie ein ⇧↵', () => {
    palette([modul()]);
    expect(fuss()).not.toHaveTextContent('Vorschau');
    expect(fuss()).not.toHaveTextContent('⇧');
    expect(fuss()).not.toHaveTextContent('Panel');
  });

  it('die markierte Zeile mit Vorschau trägt eine →-Marke, eine Modulzeile nicht', async () => {
    const u = userEvent.setup();
    // Startansicht: `datensaetze` vor `module` — die Person ist die erste, markierte Zeile.
    palette([person(), modul()]);
    const marke = (name: string) =>
      Array.from(screen.getByRole('option', { name }).querySelectorAll('kbd')).some(
        (k) => k.textContent === '→',
      );
    expect(marke('Florian Mustermann')).toBe(true);
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'ETB' })).toHaveAttribute('aria-selected', 'true');
    expect(marke('ETB')).toBe(false);
    // Die Marke hängt an der AKTIVEN Zeile, wie die ↵-Marke daneben.
    expect(marke('Florian Mustermann')).toBe(false);
  });

  it('nennt in der Vorschau die dort gültigen Wege', async () => {
    const u = userEvent.setup();
    palette([person()], { vorschauVerfuegbar: true });
    await u.keyboard('{ArrowRight}');
    expect(fuss()).toHaveTextContent('öffnen');
    expect(fuss()).toHaveTextContent('neuer Tab');
    expect(fuss()).toHaveTextContent('zurück');
    // Die Präfixlegende gilt in der Vorschau nicht — sie hat dort keine Liste zu filtern.
    expect(fuss()).not.toHaveTextContent('sucht im Einsatztagebuch');
  });
});
