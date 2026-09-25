import { App } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineRecoveryDrawer from './OfflineRecoveryDrawer';
import {
  queueLegacyEinreihenFuerTests,
  queueLeerenFuerTests,
  queueNichtZugeordnetZaehlen,
  schreibaktionAblehnen,
  schreibaktionEinreihen,
  schreibaktionenLaden,
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
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(await screen.findByText(/1 lokale Offline-Aktion\(en\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Geheimer Inhalt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/legacy-geheim-1/)).not.toBeInTheDocument();
    expect(screen.queryByText('#73')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mir zuordnen/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Alle Alt-Daten verwerfen' }));
    expect(
      await screen.findByText('Alle nicht attribuierbaren Alt-Daten endgültig verwerfen?'),
    ).toBeInTheDocument();
    expect(await queueNichtZugeordnetZaehlen()).toBe(1);

    await user.click(
      screen.getByRole('button', {
        name: 'Alle Alt-Daten endgültig verwerfen',
      }),
    );

    await waitFor(async () => expect(await queueNichtZugeordnetZaehlen()).toBe(0));
  });
});

describe('OfflineRecoveryDrawer: abgelehnte Betreuungsmeldungen (LFH-675)', () => {
  it('benennt Art und Objekt und zeigt Grund und vollständigen Inhalt', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'stand',
      bezirk_id: 3,
      bezeichnung: 'Uferstraße 12–40',
      daten: {
        evakuiert: 200,
        erhebung: 'gezaehlt',
        zeitpunkt_at: '2026-09-24 10:00:00',
        client_id: 'stand-abgelehnt',
      },
    });
    await schreibaktionEinreihen(11, 7, {
      art: 'belegung',
      stelle_id: 4,
      bezeichnung: 'Turnhalle Ost',
      daten: { belegt: 37, client_id: 'beleg-abgelehnt' },
    });
    const [stand, belegung] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, stand, 'Evakuierungsbezirk ‚Uferstraße 12–40‘ ist storniert');
    await schreibaktionAblehnen(11, belegung, 'Betreuungsstelle ist geschlossen');

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(
      await screen.findByText('Abgelehnte Standmeldung: Uferstraße 12–40'),
    ).toBeInTheDocument();
    expect(screen.getByText('Abgelehnte Belegungsmeldung: Turnhalle Ost')).toBeInTheDocument();
    expect(screen.getByText(/ist storniert/)).toBeInTheDocument();
    expect(screen.getByText(/"client_id": "stand-abgelehnt"/)).toBeInTheDocument();
    expect(screen.getByText(/"belegt": 37/)).toBeInTheDocument();
  });
});
