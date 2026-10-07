import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinsatzSwitcher from './EinsatzSwitcher';

function einsatz(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    bezeichnung: 'Hochwasser',
    stichwort: null,
    status: 'aktiv',
    begonnen_at: '2026-05-23 09:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
    ...over,
  };
}

function PfadSonde() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

function setup() {
  return renderMitProviders(
    <>
      <Routes>
        <Route
          path="/einsaetze/:id/*"
          element={<EinsatzSwitcher aktuellId={7} aktuellName="Hochwasser" />}
        />
        <Route path="/einsaetze" element={<div>Heim-Seite</div>} />
      </Routes>
      <PfadSonde />
    </>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EinsatzSwitcher', () => {
  it('zeigt nur aktive Einsaetze plus Aktionen', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz({ id: 7, bezeichnung: 'Hochwasser' }),
          einsatz({ id: 8, bezeichnung: 'MANV B14' }),
          einsatz({ id: 9, bezeichnung: 'Alt-Einsatz', status: 'abgeschlossen' }),
        ]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await waitFor(() => expect(screen.getByText('MANV B14')).toBeInTheDocument());
    expect(screen.queryByText('Alt-Einsatz')).not.toBeInTheDocument();
    expect(screen.getByText('Alle Einsätze …')).toBeInTheDocument();
    // Verwaltung gehört nicht in den Wechsler (LFH-954): sie steht gesperrt-statt-versteckt im Kopf.
    expect(screen.queryByText('Stammdaten')).not.toBeInTheDocument();
  });

  it('markiert den eigenen Einsatz, ein Klick darauf bleibt im Modul (LFH-954)', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz({ id: 7, bezeichnung: 'Hochwasser' }),
          einsatz({ id: 8, bezeichnung: 'MANV B14' }),
        ]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    const menue = await screen.findByRole('menu');
    const eigen = within(menue).getByRole('menuitem', { name: /Hochwasser/ });
    expect(eigen.className).toMatch(/-menu-item-selected/);
    expect(within(menue).getByRole('menuitem', { name: /MANV B14/ }).className).not.toMatch(
      /-menu-item-selected/,
    );
    await userEvent.click(eigen);
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/etb');
  });

  it('führt den eigenen Einsatz auch abgeschlossen und markiert ihn', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([einsatz({ id: 7, status: 'abgeschlossen' })]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    const eigen = await screen.findByRole('menuitem', { name: /Hochwasser/ });
    expect(eigen.className).toMatch(/-menu-item-selected/);
  });

  it('wechselt über einen anderen Einsatz in dessen Rahmen', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([einsatz({ id: 7 }), einsatz({ id: 8, bezeichnung: 'MANV B14' })]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /MANV B14/ }));
    await waitFor(() => expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/8'));
  });

  it('nennt je Einsatz Nummer und Ort in einer Nebenzeile, soweit vorhanden', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz({ id: 7, einsatznummer_intern: 'E-2026-0431', einsatzort: 'Deich West' }),
          einsatz({ id: 8, bezeichnung: 'MANV B14', leitstellen_nr: '4711' }),
          einsatz({ id: 9, bezeichnung: 'Ohne Angaben' }),
        ]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    const menue = await screen.findByRole('menu');
    expect(within(menue).getByRole('menuitem', { name: /Hochwasser/ })).toHaveTextContent(
      'E-2026-0431 · Deich West',
    );
    expect(within(menue).getByRole('menuitem', { name: /MANV B14/ })).toHaveTextContent('4711');
    expect(
      within(menue)
        .getByRole('menuitem', { name: /Ohne Angaben/ })
        .querySelector('[data-lfh="wechsler-nebenzeile"]'),
    ).toBeNull();
  });

  /**
   * Ein Rahmen mit `flex: 1; min-width: 0` im Layout reicht NICHT: ein antd-Knopf kürzt ohne
   * eigenes `overflow` nicht. jsdom rechnet kein Layout, geprüft werden die gesetzten
   * Eigenschaften; das „…" belegt `e2e/kopfzeile-schmal.spec.ts`.
   */
  it('ein langer Name kürzt und steht vollständig im title', async () => {
    const lang = 'Hochwasser Nord — Deichverteidigung Abschnitt West, Lage 3';
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/*"
          element={<EinsatzSwitcher aktuellId={7} aktuellName={lang} />}
        />
      </Routes>,
      { route: '/einsaetze/7/etb' },
    );

    const knopf = await screen.findByRole('button', { name: new RegExp(lang.slice(0, 20)) });
    // Der VOLLE Name bleibt am Knopf lesbar, auch wenn die Anzeige kürzt.
    expect(knopf).toHaveAttribute('title', lang);
    // Der Name bleibt Textinhalt und wandert NICHT in ein `aria-label` — sonst
    // kippte der zugängliche Name und die zwei Fälle oben mit ihm.
    expect(knopf).not.toHaveAttribute('aria-label');

    // DIE TRAGENDE ZEILE: ohne `maxWidth` bemäße sich der inline-flex-Knopf am Inhalt, das
    // `overflow: hidden` klippte nie, und die Behauptungen dahinter wären grün durch Nichtstun.
    expect(knopf.style.maxWidth).toBe('100%');

    const span = screen.getByText(lang);
    expect(span.style.overflow).toBe('hidden');
    expect(span.style.textOverflow).toBe('ellipsis');
    expect(span.style.whiteSpace).toBe('nowrap');
  });

  it('navigiert ueber „Alle Einsätze …" zur Heim-Seite', async () => {
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await userEvent.click(await screen.findByText('Alle Einsätze …'));
    await waitFor(() => expect(screen.getByText('Heim-Seite')).toBeInTheDocument());
  });
});
