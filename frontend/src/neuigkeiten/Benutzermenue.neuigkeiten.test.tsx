import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import BenutzerMenu from '../components/BenutzerMenu';

// Der Punkt am Eintrag „Neuigkeiten“ im Benutzermenü (Spec `neuigkeiten`): er zeigt, solange die
// laufende Version noch nicht gelesen ist. Die positive Gegenprobe steht im selben Test.
async function oeffne() {
  await userEvent.click(await screen.findByRole('button', { name: 'Benutzermenü' }));
}

describe('Benutzermenü · Neuigkeiten', () => {
  it('zeigt den Punkt, solange der Lesestand vor der laufenden Version liegt', async () => {
    server.use(
      meHandler(adminFixture()),
      http.get('/api/versionsstand', () =>
        HttpResponse.json({ laufend: '1.0.0-alpha.106', gelesen_bis: '1.0.0-alpha.100' }),
      ),
    );
    renderMitProviders(<BenutzerMenu />);

    await oeffne();

    expect(await screen.findByLabelText('ungelesen')).toBeInTheDocument();
  });

  it('zeigt keinen Punkt, wenn die laufende Version gelesen ist', async () => {
    server.use(
      meHandler(adminFixture()),
      http.get('/api/versionsstand', () =>
        HttpResponse.json({ laufend: '1.0.0-alpha.106', gelesen_bis: '1.0.0-alpha.106' }),
      ),
    );
    renderMitProviders(<BenutzerMenu />);

    await oeffne();

    expect(await screen.findByText('Neuigkeiten')).toBeInTheDocument();
    expect(screen.queryByLabelText('ungelesen')).not.toBeInTheDocument();
  });
});
