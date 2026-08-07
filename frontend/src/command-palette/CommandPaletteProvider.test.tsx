// frontend/src/command-palette/CommandPaletteProvider.test.tsx
import { useRef, useState, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider, useTastaturEbene } from './CommandPaletteProvider';
import type { TastaturAktionen } from './typen';

vi.mock('./useBefehle', () => ({
  useBefehle: (aktionen: TastaturAktionen = {}) => [
    { id: 'modul:etb', gruppe: 'module', label: 'ETB', ausfuehren: vi.fn() },
    ...Object.entries(aktionen).map(([id, ausfuehren]) => ({
      id: `tastatur:${id}`,
      gruppe: 'aktionen',
      label: id === 'speichern' ? 'Speichern' : 'Filter zurücksetzen',
      ausfuehren,
    })),
  ],
}));

function Ebene({
  name,
  aktionen,
  children,
}: {
  name: string;
  aktionen: TastaturAktionen;
  children?: ReactNode;
}) {
  const wurzel = useRef<HTMLDivElement>(null);
  useTastaturEbene({ name, wurzel, aktionen, aktiv: true });
  return (
    <div ref={wurzel} data-testid={name}>
      <button type="button">{name} fokussieren</button>
      {children}
    </div>
  );
}

function taste(ziel: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  ziel.dispatchEvent(event);
  return event;
}

describe('CommandPaletteProvider', () => {
  it('lässt useTastaturEbene ohne Provider als sicheren No-op rendern', () => {
    const speichern = vi.fn();
    renderMitProviders(<Ebene name="isoliert" aktionen={{ speichern }} />);

    screen.getByRole('button', { name: 'isoliert fokussieren' }).focus();
    const event = taste(window, { key: 's', ctrlKey: true });

    expect(speichern).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('öffnet die Palette mit STRG+K und schließt mit erneutem Druck', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('öffnet die Palette auch mit CMD+K (Meta-Taste, AK1)', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await u.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('ignoriert Cmd/Strg+K, Mutationen und Escape während einer IME-Komposition', () => {
    const speichern = vi.fn();
    const verwerfen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern, verwerfen }} />
      </CommandPaletteProvider>,
    );
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();

    const k = taste(window, { key: 'k', ctrlKey: true, isComposing: true });
    const s = taste(window, { key: 's', ctrlKey: true, isComposing: true });
    const escape = taste(window, { key: 'Escape', isComposing: true });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(speichern).not.toHaveBeenCalled();
    expect(verwerfen).not.toHaveBeenCalled();
    expect(k.defaultPrevented).toBe(false);
    expect(s.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('lässt eine offene Palette bei komponierendem Escape offen', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);
    await u.keyboard('{Control>}k{/Control}');
    const eingabe = screen.getByRole('combobox');

    fireEvent.keyDown(eingabe, { key: 'Escape', isComposing: true });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('ignoriert Cmd/Strg+K mit Shift oder Alt', () => {
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);

    const shiftK = taste(window, { key: 'k', ctrlKey: true, shiftKey: true });
    const altK = taste(window, { key: 'k', metaKey: true, altKey: true });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(shiftK.defaultPrevented).toBe(false);
    expect(altK.defaultPrevented).toBe(false);
  });

  it('ignoriert globale Mutationstasten mit Shift oder Alt', () => {
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern, 'filter-zuruecksetzen': filterZuruecksetzen }} />
      </CommandPaletteProvider>,
    );
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();

    const ereignisse = [
      taste(window, { key: 's', ctrlKey: true, shiftKey: true }),
      taste(window, { key: 'Enter', metaKey: true, altKey: true }),
      taste(window, { key: 'Backspace', ctrlKey: true, altKey: true }),
    ];

    expect(speichern).not.toHaveBeenCalled();
    expect(filterZuruecksetzen).not.toHaveBeenCalled();
    expect(ereignisse.every((ereignis) => !ereignis.defaultPrevented)).toBe(true);
  });

  it('führt bei überlappenden Wurzeln nur die tiefste fokussierte Ebene aus', () => {
    const aussen = vi.fn();
    const innen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="außen" aktionen={{ speichern: aussen }}>
          <Ebene name="innen" aktionen={{ speichern: innen }} />
        </Ebene>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'innen fokussieren' }).focus();
    const event = taste(window, { key: 's', ctrlKey: true });

    expect(innen).toHaveBeenCalledTimes(1);
    expect(aussen).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('deaktiviert die Ebene, wenn der Fokus in eine unregistrierte Wurzel wechselt', () => {
    const speichern = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern }} />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();
    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();

    const event = taste(window, { key: 's', ctrlKey: true });

    expect(speichern).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('respektiert lokale defaultPrevented-Handler und ignoriert Wiederholungen', () => {
    const speichern = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern }}>
          <button type="button" onKeyDown={(event) => event.preventDefault()}>lokal behandelt</button>
        </Ebene>
      </CommandPaletteProvider>,
    );
    const lokal = screen.getByRole('button', { name: 'lokal behandelt' });
    lokal.focus();

    fireEvent.keyDown(lokal, { key: 's', ctrlKey: true });
    taste(window, { key: 's', ctrlKey: true, repeat: true });

    expect(speichern).not.toHaveBeenCalled();
  });

  it('lässt Cmd/Strg+Backspace ohne Callback nativ und setzt mit Callback genau einmal zurück', () => {
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    const { rerender } = renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="ebene" aktionen={{ speichern }} />
      </CommandPaletteProvider>,
    );
    screen.getByRole('button', { name: 'ebene fokussieren' }).focus();

    const ohneCallback = taste(window, { key: 'Backspace', ctrlKey: true });
    expect(ohneCallback.defaultPrevented).toBe(false);

    rerender(
      <CommandPaletteProvider>
        <Ebene name="ebene" aktionen={{ speichern, 'filter-zuruecksetzen': filterZuruecksetzen }} />
      </CommandPaletteProvider>,
    );
    const mitCallback = taste(window, { key: 'Backspace', ctrlKey: true });

    expect(filterZuruecksetzen).toHaveBeenCalledTimes(1);
    expect(mitCallback.defaultPrevented).toBe(true);
  });

  it('sperrt die Ebene unter der Palette und stellt sie nach Escape wieder her', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    const verwerfen = vi.fn();
    const filterZuruecksetzen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern, verwerfen, 'filter-zuruecksetzen': filterZuruecksetzen }} />
      </CommandPaletteProvider>,
    );
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await u.keyboard('{Control>}s{/Control}');
    await u.keyboard('{Control>}{Enter}{/Control}');
    await u.keyboard('{Control>}{Backspace}{/Control}');
    expect(speichern).not.toHaveBeenCalled();
    expect(filterZuruecksetzen).not.toHaveBeenCalled();

    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(verwerfen).not.toHaveBeenCalled();

    taste(window, { key: 's', ctrlKey: true });
    expect(speichern).toHaveBeenCalledTimes(1);
  });

  it('lässt ein lokal verhindertes Escape weder die Palette noch die Ebene schließen', async () => {
    const u = userEvent.setup();
    const verwerfen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ verwerfen }} />
      </CommandPaletteProvider>,
    );
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();

    await u.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox');
    input.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    const verhindert = new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    });
    input.dispatchEvent(verhindert);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(verwerfen).not.toHaveBeenCalled();
  });

  it('entfernt eine aktive Ebene beim Unmount vollständig', () => {
    const speichern = vi.fn();

    function Harness() {
      const [sichtbar, setSichtbar] = useState(true);
      return (
        <CommandPaletteProvider>
          {sichtbar && <Ebene name="formular" aktionen={{ speichern }} />}
          <button type="button" onClick={() => setSichtbar(false)}>entfernen</button>
        </CommandPaletteProvider>
      );
    }

    renderMitProviders(<Harness />);
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'entfernen' }));
    const event = taste(window, { key: 's', ctrlKey: true });

    expect(speichern).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('löst einen sichtbaren Palettenbefehl über den neuesten Callback der Ebene auf', async () => {
    const u = userEvent.setup();
    const vorher = vi.fn();
    const nachher = vi.fn();

    function Harness() {
      const [aktuell, setAktuell] = useState(false);
      return (
        <CommandPaletteProvider>
          <Ebene name="formular" aktionen={{ speichern: aktuell ? nachher : vorher }}>
            <button type="button" onClick={() => setAktuell(true)}>Callback wechseln</button>
          </Ebene>
        </CommandPaletteProvider>
      );
    }

    renderMitProviders(<Harness />);
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Callback wechseln' }));
    fireEvent.click(screen.getByRole('option', { name: 'Speichern' }));

    expect(vorher).not.toHaveBeenCalled();
    expect(nachher).toHaveBeenCalledTimes(1);
  });

  it('aktualisiert bei offener Palette die verfügbaren Aktionsbefehle', async () => {
    const u = userEvent.setup();

    function Harness() {
      const [filter, setFilter] = useState(false);
      return (
        <CommandPaletteProvider>
          <Ebene
            name="kontext"
            aktionen={filter ? { 'filter-zuruecksetzen': vi.fn() } : { speichern: vi.fn() }}
          >
            <button type="button" onClick={() => setFilter(true)}>Aktionen wechseln</button>
          </Ebene>
        </CommandPaletteProvider>
      );
    }

    renderMitProviders(<Harness />);
    screen.getByRole('button', { name: 'kontext fokussieren' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aktionen wechseln' }));

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Speichern' })).not.toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Filter zurücksetzen' })).toBeInTheDocument();
    });
  });
});
