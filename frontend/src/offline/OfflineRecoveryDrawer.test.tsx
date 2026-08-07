import { App } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineRecoveryDrawer from './OfflineRecoveryDrawer';
import {
  queueLegacyEinreihenFuerTests,
  queueLeerenFuerTests,
  queueNichtZugeordnetZaehlen,
} from './queue';

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('OfflineRecoveryDrawer: nicht attribuierbare Legacy-Daten', () => {
  it('zeigt nur den anonymen Zähler und verwirft alle Alt-Daten erst nach Bestätigung', async () => {
    await queueLegacyEinreihenFuerTests(73, {
      typ: 'meldung',
      inhalt: 'Geheimer Inhalt aus früherer Sitzung',
      client_id: 'legacy-geheim-1',
    });
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer
          open
          onClose={vi.fn()}
          benutzerId={11}
        />
      </App>,
    );

    expect(await screen.findByText(/1 lokale Offline-Aktion\(en\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Geheimer Inhalt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/legacy-geheim-1/)).not.toBeInTheDocument();
    expect(screen.queryByText('#73')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mir zuordnen/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Alle Alt-Daten verwerfen' }));
    expect(await screen.findByText(
      'Alle nicht attribuierbaren Alt-Daten endgültig verwerfen?',
    )).toBeInTheDocument();
    expect(await queueNichtZugeordnetZaehlen()).toBe(1);

    await user.click(screen.getByRole('button', {
      name: 'Alle Alt-Daten endgültig verwerfen',
    }));

    await waitFor(async () => expect(await queueNichtZugeordnetZaehlen()).toBe(0));
  });
});
