import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { App as AntApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { setzeZeigerGrob } from '../test/viewport';
import { HilfeSeitenleisteProvider, useHilfeSeitenleiste } from './HilfeSeitenleisteProvider';
import { findeKapitel } from './kapitel';

vi.mock('../auth/AuthContext', () => ({
  useAuthOptional: () => ({ benutzer: { id: 1 }, geraet: null }),
}));

function titel(slug: string): string {
  const k = findeKapitel(slug);
  if (!k) throw new Error(`Kapitel ${slug} fehlt`);
  return k.titel;
}

function Pfad() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

function Knopf() {
  const { oeffneHilfe } = useHilfeSeitenleiste();
  return (
    <button type="button" onClick={() => oeffneHilfe?.()}>
      Hilfe zu dieser Seite
    </button>
  );
}

function zeige(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AntApp>
        <HilfeSeitenleisteProvider>
          <Knopf />
          <Link to="/einsaetze/5/etb">zum ETB</Link>
          <Pfad />
        </HilfeSeitenleisteProvider>
      </AntApp>
    </MemoryRouter>,
  );
}

// Der erste Test lädt den Hilfe-Chunk mit allen Kapiteln; das dauert in jsdom einige Sekunden.
const LADEN = { timeout: 15000 };

/** Die Leiste, sobald sie das Kapitel trägt (vorher steht der Lade-Platzhalter des Providers). */
async function leiste() {
  await waitFor(() => expect(document.querySelector('.hilfe-seitenleiste')).not.toBeNull(), LADEN);
  return within(screen.getByRole('dialog'));
}

describe('HilfeSeitenleiste', () => {
  it('zeigt das Kapitel der Seite und folgt einem Seitenwechsel', { timeout: 20000 }, async () => {
    zeige('/einsaetze/5/lagekarte');
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe zu dieser Seite' }));
    const l = await leiste();
    expect(await l.findByText(titel('lagekarte'), {}, LADEN)).toBeInTheDocument();
    fireEvent.click(screen.getByText('zum ETB'));
    expect(await l.findByText(titel('einsatztagebuch'))).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('liegt ohne Maske neben der Seite, die Seite bleibt bedienbar (Review)', async () => {
    zeige('/einsaetze/5/lagekarte');
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe zu dieser Seite' }));
    await leiste();
    expect(document.querySelector('.lfh-hilfe-seitenleiste .ant-drawer-mask')).toBeNull();
    fireEvent.click(screen.getByText('zum ETB'));
    expect(await screen.findByText(titel('einsatztagebuch'))).toBeInTheDocument();
  });

  it('zeigt im Reiter „Tastenkürzel“ die Sprungpalette', async () => {
    zeige('/einsaetze');
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe zu dieser Seite' }));
    const l = await leiste();
    fireEvent.click(await l.findByRole('tab', { name: 'Tastenkürzel' }));
    expect(await l.findByText('Sprungpalette öffnen')).toBeInTheDocument();
  });

  it('hat bei Berührung keine Reiter', async () => {
    setzeZeigerGrob(true);
    zeige('/einsaetze');
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe zu dieser Seite' }));
    const l = await leiste();
    expect(await l.findByText(titel('einsatz-oberflaeche'))).toBeInTheDocument();
    expect(l.queryByRole('tablist')).toBeNull();
  });

  it('ein Kapitel-Link im Text öffnet die volle Hilfe und schließt die Leiste', async () => {
    zeige('/einsaetze/5/lagekarte');
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe zu dieser Seite' }));
    const l = await leiste();
    await l.findByText(titel('lagekarte'));
    const link = (await l.findAllByRole('link')).find((a) =>
      /^\/hilfe\/[a-z0-9-]+/.test(a.getAttribute('href') ?? ''),
    );
    expect(link).toBeDefined();
    const ziel = link!.getAttribute('href')!;
    fireEvent.click(link!);
    await waitFor(() => expect(screen.getByTestId('pfad')).toHaveTextContent(ziel.split('?')[0]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('„In der Hilfe öffnen“ zeigt auf das Kapitel', async () => {
    zeige('/einsaetze/5/lagekarte');
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe zu dieser Seite' }));
    const l = await leiste();
    const link = await l.findByRole('link', { name: 'In der Hilfe öffnen' });
    expect(link.getAttribute('href')).toMatch(/^\/hilfe\/lagekarte/);
  });

  it('Esc schließt und gibt den Fokus an den Knopf zurück', async () => {
    zeige('/einsaetze');
    const knopf = screen.getByRole('button', { name: 'Hilfe zu dieser Seite' });
    knopf.focus();
    fireEvent.click(knopf);
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(knopf));
  });
});
