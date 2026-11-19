import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Drawer, Modal } from 'antd';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HilfeSeitenleisteProvider,
  istHilfeAktiv,
  istTasteFuerHilfe,
  useHilfeSeitenleiste,
} from './HilfeSeitenleisteProvider';

const auth = vi.hoisted(() => ({
  wert: { benutzer: { id: 1 }, geraet: null } as { benutzer: unknown; geraet: unknown } | null,
}));
vi.mock('../auth/AuthContext', () => ({ useAuthOptional: () => auth.wert }));
// Die Leiste selbst ist Task der Seitenleiste; hier zählt nur, ob der Provider sie zeigt.
vi.mock('./HilfeSeitenleiste', () => ({
  default: function LeistenAttrappe() {
    const { offen, reiter } = useHilfeSeitenleiste();
    return offen ? <div data-testid="leiste">{reiter}</div> : null;
  },
}));

function Sonde() {
  const { oeffneHilfe } = useHilfeSeitenleiste();
  return <span data-testid="aktiv">{oeffneHilfe ? 'ja' : 'nein'}</span>;
}

function zeige(route = '/einsaetze/5/etb', extra: React.ReactNode = null) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HilfeSeitenleisteProvider>
        <Sonde />
        <input aria-label="Feld" />
        <textarea aria-label="Text" />
        <div contentEditable suppressContentEditableWarning aria-label="Editor" />
        {extra}
      </HilfeSeitenleisteProvider>
    </MemoryRouter>,
  );
}

async function taste(ziel: Element, init: KeyboardEventInit) {
  let ereignis!: KeyboardEvent;
  await act(async () => {
    ereignis = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    ziel.dispatchEvent(ereignis);
  });
  return ereignis;
}

beforeEach(() => {
  auth.wert = { benutzer: { id: 1 }, geraet: null };
});

describe('HilfeSeitenleisteProvider', () => {
  it('„?“ öffnet die Leiste auf dem Reiter „seite“, ein zweites schließt sie', async () => {
    zeige();
    await taste(document.body, { key: '?', shiftKey: true });
    expect(await screen.findByTestId('leiste')).toHaveTextContent('seite');
    await taste(document.body, { key: '?', shiftKey: true });
    expect(screen.queryByTestId('leiste')).toBeNull();
  });

  it('„?“ in einem Eingabefeld bleibt Text', async () => {
    zeige();
    for (const name of ['Feld', 'Text', 'Editor']) {
      const e = await taste(screen.getByLabelText(name), { key: '?', shiftKey: true });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(screen.queryByTestId('leiste')).toBeNull();
  });

  it('F1 öffnet auch aus einem Eingabefeld und unterdrückt die Browserhilfe', async () => {
    zeige();
    const e = await taste(screen.getByLabelText('Feld'), { key: 'F1' });
    expect(e.defaultPrevented).toBe(true);
    expect(await screen.findByTestId('leiste')).toBeInTheDocument();
  });

  it('Strg+? und Alt+? öffnen nicht', async () => {
    zeige();
    await taste(document.body, { key: '?', ctrlKey: true });
    await taste(document.body, { key: '?', altKey: true });
    await taste(document.body, { key: '?', metaKey: true });
    expect(screen.queryByTestId('leiste')).toBeNull();
  });

  it('bei offenem Dialog oder offener Sprungpalette passiert nichts', async () => {
    zeige('/einsaetze/5/etb', <div role="dialog" aria-modal="true" />);
    await taste(document.body, { key: '?', shiftKey: true });
    await taste(document.body, { key: 'F1' });
    expect(screen.queryByTestId('leiste')).toBeNull();
  });

  it('nach einem geschlossenen anderen Drawer wirkt „?“ wieder (Review)', async () => {
    function AndererDrawer() {
      const [offen, setOffen] = useState(true);
      return (
        <Drawer open={offen} onClose={() => setOffen(false)} title="Person">
          <button onClick={() => setOffen(false)}>zu</button>
        </Drawer>
      );
    }
    zeige('/einsaetze/5/personen', <AndererDrawer />);
    await taste(document.body, { key: '?', shiftKey: true });
    expect(screen.queryByTestId('leiste')).toBeNull();
    fireEvent.click(await screen.findByText('zu'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await taste(document.body, { key: '?', shiftKey: true });
    expect(await screen.findByTestId('leiste')).toBeInTheDocument();
  });

  // Dass ein GESCHLOSSENES Modal nicht mehr sperrt, zeigt nur der Browser: antd setzt das
  // `display: none` am Rahmen erst nach der Animation, die in jsdom nicht endet (wie
  // `pages/lagekarte/zeichnenEsc.ts`).
  it('ein offenes antd-Modal (auch die Sprungpalette) sperrt „?“ und F1', async () => {
    zeige(
      '/einsaetze',
      <Modal open footer={null} title="Rückfrage">
        Inhalt
      </Modal>,
    );
    await screen.findByText('Rückfrage');
    await taste(document.body, { key: '?', shiftKey: true });
    await taste(document.body, { key: 'F1' });
    expect(screen.queryByTestId('leiste')).toBeNull();
  });

  it('ist auf der Hilfeseite und auf dem gekoppelten Gerät aus', async () => {
    const { unmount } = zeige('/hilfe/lagekarte');
    expect(screen.getByTestId('aktiv')).toHaveTextContent('nein');
    await taste(document.body, { key: '?', shiftKey: true });
    expect(screen.queryByTestId('leiste')).toBeNull();
    unmount();
    auth.wert = { benutzer: { id: 1 }, geraet: { id: 2 } };
    zeige();
    expect(screen.getByTestId('aktiv')).toHaveTextContent('nein');
  });

  it('ohne Provider ist alles still', () => {
    render(<Sonde />);
    expect(screen.getByTestId('aktiv')).toHaveTextContent('nein');
  });

  it('öffnet über oeffneHilfe den gewünschten Reiter', async () => {
    function Knopf() {
      const { oeffneHilfe } = useHilfeSeitenleiste();
      return <button onClick={() => oeffneHilfe?.('kuerzel')}>auf</button>;
    }
    zeige('/einsaetze', <Knopf />);
    fireEvent.click(screen.getByText('auf'));
    expect(await screen.findByTestId('leiste')).toHaveTextContent('kuerzel');
  });
});

describe('istHilfeAktiv', () => {
  const mensch = { benutzer: { id: 1 }, geraet: null };
  it.each([
    ['/einsaetze', mensch, true],
    ['/admin/stammdaten', mensch, true],
    ['/hilfe', mensch, false],
    ['/hilfe/lagekarte', mensch, false],
    ['/geraet/5', mensch, false],
    ['/login', mensch, false],
    ['/einsaetze', { benutzer: null, geraet: null }, false],
    ['/einsaetze', { benutzer: { id: 1 }, geraet: { id: 3 } }, false],
    ['/einsaetze', null, false],
  ])('%s → %s', (pfad, a, erwartet) => {
    expect(istHilfeAktiv(pfad, a)).toBe(erwartet);
  });
});

describe('istTasteFuerHilfe', () => {
  const e = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  it('nimmt ? mit und ohne Umschalt, F1 ohne Modifikator', () => {
    expect(istTasteFuerHilfe(e({ key: '?' }))).toBe(true);
    expect(istTasteFuerHilfe(e({ key: '?', shiftKey: true }))).toBe(true);
    expect(istTasteFuerHilfe(e({ key: 'F1' }))).toBe(true);
    expect(istTasteFuerHilfe(e({ key: 'F1', ctrlKey: true }))).toBe(false);
    expect(istTasteFuerHilfe(e({ key: '?', repeat: true }))).toBe(false);
    expect(istTasteFuerHilfe(e({ key: 'ß' }))).toBe(false);
  });
});
