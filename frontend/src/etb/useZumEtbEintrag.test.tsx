import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';
import { freigabenFixture } from '../test/fixtures';
import EinsatzSeite from '../components/EinsatzSeite';
import { useZumEtbEintrag } from './useZumEtbEintrag';

/**
 * Nebenweg „Zum ETB-Eintrag" der Detailseiten (Befehl, Lagebericht, Pressemitteilung; LFH-888,
 * design.md D4): freies ETB → Sprung auf den Eintrag, gesperrtes → gesperrter Weg mit Grund.
 * Ab `md` im Sprung-Muster (LFH-968): Knopfform, „↗“, Grund im sichtbaren Text.
 */

afterEach(() => setzeViewportZurueck());

function Seite({ eintragId }: { eintragId: number | null }) {
  const etb = useZumEtbEintrag(1, eintragId);
  return (
    <EinsatzSeite titel="Bericht" weitere={{ name: 'Weitere', eintraege: etb ? [etb] : [] }}>
      <div>Inhalt</div>
    </EinsatzSeite>
  );
}

describe('useZumEtbEintrag (LFH-888)', () => {
  it('freies ETB: Link auf den Eintrag in Knopfform mit „↗“ (LFH-968)', async () => {
    setzeViewportBreite(1180);
    renderMitProviders(<Seite eintragId={42} />);
    const link = await screen.findByRole('link', { name: 'Zum ETB-Eintrag' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=42');
    expect(link).toHaveClass('ant-btn');
    expect(link).toHaveTextContent('Zum ETB-Eintrag ↗');
  });

  it('gesperrtes ETB: gesperrter Knopf, „Keine Berechtigung" sichtbar, kein Link', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    );
    setzeViewportBreite(1180);
    renderMitProviders(<Seite eintragId={42} />);
    const knopf = await screen.findByRole('button', {
      name: 'Zum ETB-Eintrag (Keine Berechtigung)',
    });
    expect(knopf).toBeDisabled();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('ohne ETB-Eintrag (Entwurf): kein Weg', () => {
    setzeViewportBreite(1180);
    renderMitProviders(<Seite eintragId={null} />);
    expect(screen.queryByText(/Zum ETB-Eintrag/)).toBeNull();
  });
});
