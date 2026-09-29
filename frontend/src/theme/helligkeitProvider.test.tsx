/**
 * Die Helligkeitsachse im Träger (LFH-397): Speicher, Merkmal am `<html>` und die
 * Warnsperre über `useWarnsperre`.
 *
 * Wie `ThemeModeProvider.test.tsx` rendert diese Datei den Provider DIREKT — der
 * Test-Wrapper hängt keinen Theme-Provider auf.
 *
 * DIE SPERRE WIRD HIER AM AUSTRITT GEPRÜFT (`data-helligkeit`), nicht an der Funktion:
 * `helligkeit.test.ts` belegt die Regel, diese Datei, dass der Provider sie auch
 * anwendet — und dass sie die gespeicherte Wahl nicht anfasst.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeModeProvider, useHelligkeit, useWarnsperre } from './ThemeModeProvider';
import { HELLIGKEIT_STUFEN } from './helligkeit';

const SCHLUESSEL = 'lifeline-hub.helligkeit';
const html = document.documentElement;

function Sonde() {
  const { helligkeit, setHelligkeit, wirksam, warnungAktiv } = useHelligkeit();
  return (
    <div>
      <span data-testid="wahl">{helligkeit}</span>
      <span data-testid="wirksam">{wirksam}</span>
      <span data-testid="warnung">{String(warnungAktiv)}</span>
      {HELLIGKEIT_STUFEN.map((s) => (
        <button key={s} type="button" onClick={() => setHelligkeit(s)}>
          {`${s} %`}
        </button>
      ))}
    </div>
  );
}

function Warnquelle({ aktiv }: { aktiv: boolean }) {
  useWarnsperre(aktiv);
  return null;
}

afterEach(() => {
  localStorage.clear();
  delete html.dataset.helligkeit;
  html.style.removeProperty('--lfh-abdunkelung');
});

describe('Helligkeit — Zustand und Persistenz', () => {
  it('ohne gespeicherte Wahl steht die Anzeige auf 100 % ohne Abdunklung', () => {
    render(
      <ThemeModeProvider>
        <Sonde />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId('wahl')).toHaveTextContent('100');
    expect(html.dataset.helligkeit).toBe('100');
    expect(html.style.getPropertyValue('--lfh-abdunkelung')).toBe('0');
  });

  it('die Wahl landet im Speicher und am <html>', async () => {
    render(
      <ThemeModeProvider>
        <Sonde />
      </ThemeModeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '40 %' }));
    expect(localStorage.getItem(SCHLUESSEL)).toBe('40');
    expect(html.dataset.helligkeit).toBe('40');
    expect(html.style.getPropertyValue('--lfh-abdunkelung')).toBe('0.6');
  });

  it('Round-Trip: die gewählte Stufe überlebt einen Remount', async () => {
    const erst = render(
      <ThemeModeProvider>
        <Sonde />
      </ThemeModeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '20 %' }));
    erst.unmount();
    render(
      <ThemeModeProvider>
        <Sonde />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId('wahl')).toHaveTextContent('20');
    expect(html.style.getPropertyValue('--lfh-abdunkelung')).toBe('0.8');
  });

  it('ein unbekannter gespeicherter Wert ist keine Wahl: 100 %', () => {
    localStorage.setItem(SCHLUESSEL, '0');
    render(
      <ThemeModeProvider>
        <Sonde />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId('wahl')).toHaveTextContent('100');
    expect(html.dataset.helligkeit).toBe('100');
  });
});

describe('Helligkeit — die Warnsperre am Austritt', () => {
  it('greift bei aktiver Warnung: Wahl 40, am <html> 80 — der Speicher bleibt 40', () => {
    localStorage.setItem(SCHLUESSEL, '40');
    render(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('80');
    expect(html.style.getPropertyValue('--lfh-abdunkelung')).toBe('0.2');
    expect(screen.getByTestId('wahl')).toHaveTextContent('40');
    expect(screen.getByTestId('wirksam')).toHaveTextContent('80');
    expect(screen.getByTestId('warnung')).toHaveTextContent('true');
    expect(localStorage.getItem(SCHLUESSEL)).toBe('40');
  });

  it('greift OHNE aktive Warnung nicht: eine Quelle mit `false` lässt 40 stehen', () => {
    localStorage.setItem(SCHLUESSEL, '40');
    render(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv={false} />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('40');
    expect(screen.getByTestId('warnung')).toHaveTextContent('false');
  });

  it('endet die Warnung, kehrt die Wahl ohne Nachstellen zurück', () => {
    localStorage.setItem(SCHLUESSEL, '40');
    const ansicht = render(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('80');
    ansicht.rerender(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv={false} />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('40');
  });

  it('eine Quelle, die abgebaut wird (Einsatz verlassen), nimmt ihre Sperre mit', () => {
    localStorage.setItem(SCHLUESSEL, '40');
    const ansicht = render(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv />
      </ThemeModeProvider>,
    );
    ansicht.rerender(
      <ThemeModeProvider>
        <Sonde />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('40');
  });

  it('zwei Quellen: das Ende der einen hebt die Sperre der anderen nicht auf', () => {
    localStorage.setItem(SCHLUESSEL, '40');
    const ansicht = render(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv />
        <Warnquelle aktiv />
      </ThemeModeProvider>,
    );
    ansicht.rerender(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv={false} />
        <Warnquelle aktiv />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('80');
  });

  it('eine neue Wahl während der Warnung wird gespeichert, wirkt aber erst nach ihr', async () => {
    const ansicht = render(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv />
      </ThemeModeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '20 %' }));
    expect(localStorage.getItem(SCHLUESSEL)).toBe('20');
    expect(html.dataset.helligkeit).toBe('80');
    ansicht.rerender(
      <ThemeModeProvider>
        <Sonde />
        <Warnquelle aktiv={false} />
      </ThemeModeProvider>,
    );
    expect(html.dataset.helligkeit).toBe('20');
  });
});
