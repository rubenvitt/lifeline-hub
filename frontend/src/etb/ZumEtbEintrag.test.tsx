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
 * Seit LFH-968 im Sprung-Muster: Knopfform in Steuerhöhe, „↗“, Grund im sichtbaren Text.
 */
describe('ZumEtbEintrag (LFH-888)', () => {
  it('freies ETB: Link auf den Eintrag in Knopfform mit „↗“ (LFH-968)', async () => {
    renderMitProviders(<ZumEtbEintrag einsatzId={1} eintragId={42} />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Zum ETB-Eintrag' })).toHaveAttribute(
        'href',
        '/einsaetze/1/etb?eintrag=42',
      ),
    );
    const link = screen.getByRole('link', { name: 'Zum ETB-Eintrag' });
    expect(link).toHaveClass('ant-btn');
    expect(link).toHaveTextContent('Zum ETB-Eintrag ↗');
  });

  it('gesperrtes ETB: gesperrter Knopf, „Keine Berechtigung" sichtbar, kein Link', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    );
    renderMitProviders(<ZumEtbEintrag einsatzId={1} eintragId={42} />);
    const knopf = await screen.findByRole('button', {
      name: 'Zum ETB-Eintrag (Keine Berechtigung)',
    });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
