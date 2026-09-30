import { useRef, useState, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import {
  CommandPaletteProvider,
  useTastaturEbene,
  verschmelzeAktionen,
} from './CommandPaletteProvider';
import type { TastaturAktionen } from './typen';

vi.mock('./useBefehle', () => {
  // Die Beschriftung steht in der Attrappe (der Wortlaut aus `TASTATUR_AKTIONEN` ist in
  // `befehle.test.ts` gepinnt). Die Aussagen unten leben davon, dass zwei Ebenen unterscheidbar
  // beschriftet sind.
  const beschriftung: Record<string, string> = {
    speichern: 'Speichern',
    'filter-zuruecksetzen': 'Filter zurücksetzen',
    verwerfen: 'Verwerfen',
    'neue-zeile': 'Neue Zeile',
    'status-setzen': 'Status setzen',
  };
  return {
    useBefehle: (aktionen: TastaturAktionen = {}) => [
      { id: 'modul:etb', gruppe: 'module', label: 'ETB', ausfuehren: vi.fn() },
      ...Object.entries(aktionen).map(([id, ausfuehren]) => ({
        id: `tastatur:${id}`,
        gruppe: 'aktionen',
        label: beschriftung[id] ?? id,
        ausfuehren,
      })),
    ],
  };
});

function Ebene({
  name,
  aktionen,
  nurMitFokus,
  children,
}: {
  name: string;
  aktionen: TastaturAktionen;
  nurMitFokus?: true;
  children?: ReactNode;
}) {
  const wurzel = useRef<HTMLDivElement>(null);
  useTastaturEbene({ name, wurzel, aktionen, aktiv: true, nurMitFokus });
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
    renderMitProviders(
      <CommandPaletteProvider>
        <div>App-Inhalt</div>
      </CommandPaletteProvider>,
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('öffnet die Palette auch mit CMD+K (Meta-Taste, AK1)', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <div>App-Inhalt</div>
      </CommandPaletteProvider>,
    );
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
    renderMitProviders(
      <CommandPaletteProvider>
        <div>App-Inhalt</div>
      </CommandPaletteProvider>,
    );
    await u.keyboard('{Control>}k{/Control}');
    const eingabe = screen.getByRole('combobox');

    fireEvent.keyDown(eingabe, { key: 'Escape', isComposing: true });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('ignoriert Cmd/Strg+K mit Shift oder Alt', () => {
    renderMitProviders(
      <CommandPaletteProvider>
        <div>App-Inhalt</div>
      </CommandPaletteProvider>,
    );

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
        <Ebene
          name="formular"
          aktionen={{ speichern, 'filter-zuruecksetzen': filterZuruecksetzen }}
        />
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

  // Nur als PAAR mit dem Test darüber aussagekräftig: dort gewinnt bei Konkurrenz die tiefste
  // Ebene, hier trägt die äußere eine Aktion, die die innere nicht kennt. Jeder Test für sich
  // wäre mit einer trivialen Fehlimplementierung grün (Merge-Richtung verdreht, Kette weggelassen).
  it('führt die Aktion einer ÄUSSEREN Ebene aus, wenn die fokussierte innere sie nicht kennt', () => {
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="außen" aktionen={{ speichern }}>
          <Ebene name="innen" aktionen={{ 'filter-zuruecksetzen': filterZuruecksetzen }} />
        </Ebene>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'innen fokussieren' }).focus();
    const event = taste(window, { key: 's', ctrlKey: true });

    expect(speichern).toHaveBeenCalledTimes(1);
    expect(filterZuruecksetzen).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  /**
   * Der Anzeige-Fallback: der Klick auf den „Suchen“-Knopf nimmt den Fokus aus jeder Wurzel, die
   * Kette ist leer, und „Aktionen“ bliebe auf genau diesem Bedienweg leer.
   *
   * PAAR: der Fallback gilt für die ANZEIGE (bewusster Griff auf eine beschriftete Zeile), NICHT
   * für den Tastenweg. Wandert er nach `waehleEbene`, wird der zweite Test rot.
   */
  it('zeigt bei leerer Kette die Aktionen der flachsten registrierten Ebene', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern }} />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();
  });

  it('lässt die Fallback-Ebene NICHT auf den Tastenweg durchschlagen', () => {
    const speichern = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern }} />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    const event = taste(window, { key: 's', ctrlKey: true });

    expect(speichern).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  /**
   * `oeffne` merkt sich die ROHE Kette. Mit Fallback darin gäbe `schliesse` ihn als AKTIVE Kette an
   * den Tastenweg zurück, und nach Escape riefe Strg+S das `speichern` eines Formulars, in dem der
   * Fokus nie war. Das Ereignis geht an `window`, damit die restaurierte Kette stehen bleibt
   * (`aufTaste` wählte am DOM-Ziel neu aus).
   */
  it('gibt nach Escape KEINE Fallback-Ebene an den Tastenweg zurück', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="formular" aktionen={{ speichern }} />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    // Positivhälfte: der Fallback steht wirklich in der ANZEIGE.
    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();

    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    const event = taste(window, { key: 's', ctrlKey: true });

    expect(speichern).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  /**
   * Richtung des Fallbacks mit ZWEI Ebenen; mit einer wäre „flachste“ nicht widerlegbar.
   */
  it('nimmt für den Fallback die FLACHSTE Ebene, nicht die tiefste', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="seite" aktionen={{ speichern }}>
          <Ebene name="werkzeugzeile" aktionen={{ 'filter-zuruecksetzen': filterZuruecksetzen }} />
        </Ebene>
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Filter zurücksetzen' })).not.toBeInTheDocument();
  });

  // Gleichstand: die zuerst registrierte gewinnt. Gepinnt ist das ERGEBNIS, nicht der Weg dorthin.
  it('nimmt bei gleicher Tiefe die zuerst registrierte Ebene', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    const verwerfen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="erste" aktionen={{ speichern }} />
        <Ebene name="zweite" aktionen={{ verwerfen }} />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Verwerfen' })).not.toBeInTheDocument();
  });

  /**
   * Sichtbarkeit des Fallback-Kandidaten: antds `Tabs` lassen einen verlassenen Reiter mit
   * `aria-hidden="true"` im Baum. Die versteckte Ebene steht ZUERST und gewönne ohne den Filter.
   */
  it('überspringt beim Fallback eine Ebene unter aria-hidden', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <div aria-hidden="true">
          <Ebene name="verlassener Reiter" aktionen={{ speichern }} />
        </div>
        <div>
          <Ebene
            name="sichtbarer Reiter"
            aktionen={{ 'filter-zuruecksetzen': filterZuruecksetzen }}
          />
        </div>
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('option', { name: 'Filter zurücksetzen' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Speichern' })).not.toBeInTheDocument();
  });

  /**
   * Eine Ebene ohne belegte Aktion wäre als flachste eine Sperre: sie gewönne den Fallback und
   * hätte nichts anzubieten. `{ 'neue-zeile': undefined }` ist der Bestandsfall (`EinsatzSeite`
   * reicht den Callback samt Rechte-Riegel durch).
   */
  it('überspringt beim Fallback eine Ebene ohne belegte Aktion', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="leere Seitenebene" aktionen={{ 'neue-zeile': undefined }}>
          <Ebene name="werkzeugzeile" aktionen={{ speichern }} />
        </Ebene>
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();
  });

  /**
   * Ebenen „nur mit Fokus“ (LFH-507): eine Zeilenebene wirkt auf GENAU die Zeile, in der der Fokus
   * lag. Als Anzeige-Fallback böte sie „Status setzen“ für eine beliebige Zeile an. Eine EINZIGE
   * registrierte Ebene, damit die Aussage nicht an der DOM-Tiefe hängt: ohne die Marke wäre sie der
   * Fallback.
   */
  it('zeigt eine Ebene „nur mit Fokus“ NICHT als Anzeige-Fallback', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="zeile" aktionen={{ 'status-setzen': vi.fn() }} nurMitFokus />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Status setzen' })).not.toBeInTheDocument();
  });

  it('zeigt eine Ebene „nur mit Fokus“, wenn der Fokus in ihrer Wurzel liegt', async () => {
    const u = userEvent.setup();
    const statusSetzen = vi.fn();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="zeile" aktionen={{ 'status-setzen': statusSetzen }} nurMitFokus />
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'zeile fokussieren' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    await u.click(screen.getByRole('option', { name: 'Status setzen' }));

    expect(statusSetzen).toHaveBeenCalledTimes(1);
  });

  // Die Marke nimmt nur SICH aus dem Fallback, sie sperrt ihn nicht: die nächste Ebene rückt nach.
  it('nimmt für den Fallback die nächste Ebene, wenn die flachste „nur mit Fokus“ gilt', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <Ebene name="zeile" aktionen={{ 'status-setzen': vi.fn() }} nurMitFokus />
        <div>
          <Ebene name="werkzeugzeile" aktionen={{ 'filter-zuruecksetzen': vi.fn() }} />
        </div>
        <button type="button">unregistrierte Kopfzeile</button>
      </CommandPaletteProvider>,
    );

    screen.getByRole('button', { name: 'unregistrierte Kopfzeile' }).focus();
    await u.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('option', { name: 'Filter zurücksetzen' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Status setzen' })).not.toBeInTheDocument();
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
          <button type="button" onKeyDown={(event) => event.preventDefault()}>
            lokal behandelt
          </button>
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
        <Ebene
          name="formular"
          aktionen={{ speichern, verwerfen, 'filter-zuruecksetzen': filterZuruecksetzen }}
        />
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
      key: 'Escape',
      bubbles: true,
      cancelable: true,
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
          <button type="button" onClick={() => setSichtbar(false)}>
            entfernen
          </button>
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

  /**
   * Das Cleanup FILTERT die gemerkte Kette, statt sie zu leeren: remountet eine Werkzeugleiste bei
   * offener Palette, darf die Aktion der äußeren Ebene nicht verloren gehen. Die fremde Ebene liegt
   * flacher als die Seite, sonst wäre der Test auch mit der naiven Fassung grün.
   */
  it('behält beim Abmelden der inneren Ebene die Aktion der äußeren', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    const verwerfen = vi.fn();

    function Harness() {
      const [werkzeug, setWerkzeug] = useState(true);
      return (
        <CommandPaletteProvider>
          <Ebene name="fremde Seite" aktionen={{ verwerfen }} />
          <div>
            <Ebene name="seite" aktionen={{ speichern }}>
              {werkzeug && (
                <Ebene
                  name="werkzeugzeile"
                  aktionen={{ 'filter-zuruecksetzen': filterZuruecksetzen }}
                />
              )}
              <button type="button" onClick={() => setWerkzeug(false)}>
                Werkzeugzeile entfernen
              </button>
            </Ebene>
          </div>
        </CommandPaletteProvider>
      );
    }

    renderMitProviders(<Harness />);
    screen.getByRole('button', { name: 'werkzeugzeile fokussieren' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('option', { name: 'Filter zurücksetzen' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();

    // `fireEvent` statt `u.click`: ein Klick mit Fokuswechsel räumte die Kette ohnehin über
    // `focusin`; geprüft wird das Cleanup der Abmeldung.
    fireEvent.click(screen.getByRole('button', { name: 'Werkzeugzeile entfernen' }));

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Filter zurücksetzen' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Verwerfen' })).not.toBeInTheDocument();
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
            <button type="button" onClick={() => setAktuell(true)}>
              Callback wechseln
            </button>
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
            <button type="button" onClick={() => setFilter(true)}>
              Aktionen wechseln
            </button>
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

/**
 * Die Auflösungsregel der Ebenen-KETTE ohne DOM: „tief gewinnt“ als Regel, nicht als zufällige
 * Verschachtelung im Test.
 */
describe('verschmelzeAktionen', () => {
  it('lässt bei gleichem Schlüssel die TIEFSTE Ebene gewinnen', () => {
    const tief = vi.fn();
    const flach = vi.fn();

    const verschmolzen = verschmelzeAktionen([{ speichern: tief }, { speichern: flach }]);
    verschmolzen.speichern?.();

    expect(tief).toHaveBeenCalledTimes(1);
    expect(flach).not.toHaveBeenCalled();
  });

  it('reicht Schlüssel durch, die nur eine flachere Ebene kennt', () => {
    const verwerfen = vi.fn();

    const verschmolzen = verschmelzeAktionen([{ speichern: vi.fn() }, { verwerfen }]);

    expect(Object.keys(verschmolzen).sort()).toEqual(['speichern', 'verwerfen']);
    verschmolzen.verwerfen?.();
    expect(verwerfen).toHaveBeenCalledTimes(1);
  });

  // Ein Schlüssel mit `undefined` ist der Normalfall (`speichern: darfIch ? cb : undefined`); als
  // Belegung verdeckte er die Aktion einer flacheren Ebene.
  it('behandelt einen undefined-Wert als NICHT belegt', () => {
    const flach = vi.fn();

    const verschmolzen = verschmelzeAktionen([{ speichern: undefined }, { speichern: flach }]);
    verschmolzen.speichern?.();

    expect(flach).toHaveBeenCalledTimes(1);
  });

  it('liefert für eine leere Kette ein leeres Ergebnis', () => {
    expect(Object.keys(verschmelzeAktionen([]))).toEqual([]);
  });
});
