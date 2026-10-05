import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import ZumEtbEintrag from './ZumEtbEintrag';

/**
 * Kopfaktion „Zum ETB-Eintrag" der Detailseiten (Befehl, Lagebericht, Pressemitteilung; LFH-888,
 * design.md D4): freies ETB → Link auf den Eintrag, gesperrtes → gesperrter Knopf mit Grund.
 */
describe('ZumEtbEintrag (LFH-888)', () => {
  it('freies ETB: Link auf den Eintrag', async () => {
    renderMitProviders(<ZumEtbEintrag einsatzId={1} eintragId={42} />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Zum ETB-Eintrag' })).toHaveAttribute(
        'href',
        '/einsaetze/1/etb?eintrag=42',
      ),
    );
  });

  it('gesperrtes ETB: gesperrter Knopf mit „Keine Berechtigung", kein Link', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    );
    renderMitProviders(<ZumEtbEintrag einsatzId={1} eintragId={42} />);
    const knopf = await screen.findByRole('button', { name: 'Zum ETB-Eintrag' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
