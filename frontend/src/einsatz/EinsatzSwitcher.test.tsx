import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
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

function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/*" element={<EinsatzSwitcher aktuellName="Hochwasser" />} />
      <Route path="/einsaetze" element={<div>Heim-Seite</div>} />
      <Route path="/stammdaten" element={<div>Stammdaten-Seite</div>} />
    </Routes>,
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
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
  });

  /**
   * Ein Rahmen mit `flex: 1; min-width: 0` im Layout reicht NICHT: der Name
   * sitzt in einem antd-Knopf, und der kürzt ohne eigenes `overflow` nicht,
   * sondern schiebt die Kopfzeile breit. Diese Hälfte gehört deshalb hierher.
   *
   * jsdom rechnet kein Layout — geprüft werden die gesetzten Eigenschaften.
   * Dass daraus wirklich ein „…" wird, belegt `e2e/kopfzeile-schmal.spec.ts`.
   */
  it('ein langer Name kürzt und steht vollständig im title', async () => {
    const lang = 'Hochwasser Nord — Deichverteidigung Abschnitt West, Lage 3';
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/*" element={<EinsatzSwitcher aktuellName={lang} />} />
      </Routes>,
      { route: '/einsaetze/7/etb' },
    );

    const knopf = await screen.findByRole('button', { name: new RegExp(lang.slice(0, 20)) });
    // Der VOLLE Name bleibt am Knopf lesbar, auch wenn die Anzeige kürzt.
    expect(knopf).toHaveAttribute('title', lang);
    // Der Name bleibt Textinhalt und wandert NICHT in ein `aria-label` — sonst
    // kippte der zugängliche Name und die zwei Fälle oben mit ihm.
    expect(knopf).not.toHaveAttribute('aria-label');

    // DIE TRAGENDE ZEILE: ohne `maxWidth` bemäße sich der inline-flex-Knopf am
    // Inhalt, das `overflow: hidden` darunter klippte nie, und die drei
    // Behauptungen dahinter wären grün durch Nichtstun (per Mutationsprobe
    // belegt: ohne diese Zeile bleibt der Test auch ohne `maxWidth` grün).
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
