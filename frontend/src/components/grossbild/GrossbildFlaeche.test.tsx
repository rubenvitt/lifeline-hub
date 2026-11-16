import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  zoneSetzen,
  zoneZuruecksetzenFuerTests,
  type ZonenEintrag,
} from '../../alarm/alarmZoneSpeicher';
import GrossbildFlaeche from './GrossbildFlaeche';
import { setzeLiveStatusFuerTest } from '../../live/liveStatusStore';

const UEBUNG = { einsatzart: 'uebung' as const };

let vollbildAnfordern: ReturnType<typeof vi.fn>;
let vollbildVerlassen: ReturnType<typeof vi.fn>;
let vollbildElement: Element | null = null;

function setVollbildElement(el: Element | null) {
  vollbildElement = el;
  document.dispatchEvent(new Event('fullscreenchange'));
}

beforeEach(() => {
  vollbildElement = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => vollbildElement,
  });
  vollbildAnfordern = vi.fn(function (this: Element) {
    setVollbildElement(this);
    return Promise.resolve();
  });
  vollbildVerlassen = vi.fn(() => {
    setVollbildElement(null);
    return Promise.resolve();
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: vollbildAnfordern,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vollbildVerlassen,
  });
  const wurzel = document.createElement('div');
  wurzel.id = 'root';
  document.body.appendChild(wurzel);
});

afterEach(() => {
  delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  document.getElementById('root')?.remove();
  document.documentElement.style.overflow = '';
  zoneZuruecksetzenFuerTests();
  setzeLiveStatusFuerTest('idle');
});

/** Seite mit Knopf „Großbild“, wie Lagebild und Lagebesprechung sie bauen. */
function Seite({ einsatz }: { einsatz?: { einsatzart: 'uebung' | 'realeinsatz' } }) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Großbild
      </button>
      {offen && (
        <GrossbildFlaeche
          titel="Lagebild"
          meta="1430"
          einsatz={einsatz}
          onVerlassen={() => setOffen(false)}
        >
          <p>Inhalt</p>
        </GrossbildFlaeche>
      )}
    </>
  );
}

function openGrossbild() {
  render(<Seite />, { container: document.getElementById('root')! });
  fireEvent.click(screen.getByRole('button', { name: 'Großbild' }));
}

function eintrag(stufe: 'alarm' | 'hinweis', titel: string): ZonenEintrag {
  return {
    schluessel: titel,
    stufe,
    titel,
    name: 'Test',
    oeffnen: () => undefined,
    ausblenden: () => undefined,
  };
}

describe('GrossbildFlaeche (LLH-1747, Spec `grossbild-ansicht`)', () => {
  it('zeigt die Fläche als Dialog außerhalb der App und fordert Vollbild für sie an', () => {
    openGrossbild();
    const dialog = screen.getByRole('dialog', { name: 'Lagebild' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.getElementById('root')!.contains(dialog)).toBe(false);
    expect(vollbildAnfordern).toHaveBeenCalledTimes(1);
    expect(vollbildAnfordern.mock.contexts[0]).toBe(dialog);
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    expect(screen.getByText('1430')).toBeInTheDocument();
  });

  it('sperrt die App dahinter und das Rollen des Dokuments, solange sie steht', () => {
    openGrossbild();
    expect(document.getElementById('root')!.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Großbild verlassen' }));
    expect(document.getElementById('root')!.inert).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('setzt den Fokus auf „Großbild verlassen“ und gibt ihn danach an den Knopf zurück', () => {
    render(<Seite />, { container: document.getElementById('root')! });
    const knopf = screen.getByRole('button', { name: 'Großbild' });
    knopf.focus();
    fireEvent.click(knopf);
    expect(screen.getByRole('button', { name: 'Großbild verlassen' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Großbild verlassen' }));
    expect(knopf).toHaveFocus();
  });

  it('endet, wenn der Browser das Vollbild verlässt (Esc im Vollbild)', () => {
    openGrossbild();
    act(() => setVollbildElement(null));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('endet mit Esc, wenn kein Vollbild läuft', () => {
    vollbildAnfordern.mockImplementation(() => Promise.reject(new Error('abgelehnt')));
    openGrossbild();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('beendet beim Verlassen ein laufendes Vollbild', () => {
    openGrossbild();
    fireEvent.click(screen.getByRole('button', { name: 'Großbild verlassen' }));
    expect(vollbildVerlassen).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bleibt bei abgelehntem Vollbild stehen und bietet „Vollbild“ an', async () => {
    vollbildAnfordern.mockImplementationOnce(() => Promise.reject(new Error('abgelehnt')));
    openGrossbild();
    await act(async () => undefined);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vollbild' }));
    expect(vollbildAnfordern).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Vollbild' })).toBeNull();
  });

  it('zeigt im Vollbild keinen Knopf „Vollbild“', () => {
    openGrossbild();
    expect(screen.queryByRole('button', { name: 'Vollbild' })).toBeNull();
  });

  it('hat ohne Vollbild-API keinen Knopf „Vollbild“ und füllt das Fenster', () => {
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
    openGrossbild();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.position).toBe('fixed');
    expect(screen.queryByRole('button', { name: 'Vollbild' })).toBeNull();
  });

  it('hat außer Verlassen und Vollbild nichts zu bedienen', () => {
    vollbildAnfordern.mockImplementationOnce(() => Promise.reject(new Error('abgelehnt')));
    openGrossbild();
    const knoepfe = screen
      .getAllByRole('button')
      .filter((b) => screen.getByRole('dialog').contains(b));
    expect(knoepfe.map((k) => k.textContent)).toEqual(['Vollbild', 'Großbild verlassen']);
  });

  it('nennt Alarme der Alarmzone als Zahl, ohne Titel', () => {
    act(() => zoneSetzen(Symbol('t'), [eintrag('alarm', 'Herr Muster vermisst')]));
    openGrossbild();
    expect(screen.getByText('1 Alarm offen')).toBeInTheDocument();
    expect(screen.queryByText(/Muster/)).toBeNull();
    act(() =>
      zoneSetzen(Symbol('t'), [
        eintrag('alarm', 'a'),
        eintrag('alarm', 'b'),
        eintrag('hinweis', 'c'),
      ]),
    );
    expect(screen.getByText('2 Alarme offen')).toBeInTheDocument();
    expect(screen.getByText('1 Hinweis offen')).toBeInTheDocument();
  });

  it('zeigt ohne Einträge keine Alarmzahl', () => {
    openGrossbild();
    expect(screen.queryByText(/Alarm/)).toBeNull();
  });

  it('lässt keine Taste zu den Kürzeln der App durch, Esc beendet trotzdem (Review vor dem PR)', () => {
    // Die Sprungpalette hört am `window` (CommandPaletteProvider); im Großbild darf sie nicht aufgehen.
    const appKuerzel = vi.fn();
    window.addEventListener('keydown', appKuerzel);
    try {
      openGrossbild();
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
      expect(appKuerzel).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      // Danach erreicht jede Taste die App wieder.
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
      expect(appKuerzel).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', appKuerzel);
    }
  });

  it('nennt eine gestörte Verbindung wie die Kopfleiste, die es verdeckt', () => {
    openGrossbild();
    const verbindung = () => document.querySelector('[data-lfh="grossbild-verbindung"]');
    act(() => setzeLiveStatusFuerTest('open'));
    expect(verbindung()).toBeNull();
    act(() => setzeLiveStatusFuerTest('lost'));
    expect(verbindung()).toHaveTextContent('Verbindung getrennt');
    // Bei einem Netzfehler bleibt der Strom endlos im Aufbau, „lost“ kommt nie.
    act(() => setzeLiveStatusFuerTest('connecting'));
    expect(verbindung()).toHaveTextContent('Verbindung wird wiederhergestellt');
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(verbindung()).toHaveTextContent('Ohne Netz');
    } finally {
      onLine.mockRestore();
    }
  });

  it('sperrt auch Portale am body, die erst während des Großbilds erscheinen', () => {
    const vorher = document.createElement('div');
    document.body.appendChild(vorher);
    try {
      openGrossbild();
      expect(vorher.inert).toBe(true);
      // Ein Eingangsband hängt sich per Portal an den body.
      const band = document.createElement('div');
      act(() => {
        document.body.appendChild(band);
      });
      return Promise.resolve().then(() => {
        expect(band.inert).toBe(true);
        expect(screen.getByRole('dialog').inert).not.toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Großbild verlassen' }));
        expect(vorher.inert).toBe(false);
        expect(band.inert).toBe(false);
        band.remove();
      });
    } finally {
      vorher.remove();
    }
  });

  it('trägt bei einer Übung die Übungsmarke', () => {
    render(<Seite einsatz={UEBUNG} />, { container: document.getElementById('root')! });
    fireEvent.click(screen.getByRole('button', { name: 'Großbild' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Übung');
  });
});
