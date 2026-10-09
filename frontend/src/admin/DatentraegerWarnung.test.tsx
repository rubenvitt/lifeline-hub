import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import type { BenutzerAnzeige, DatentraegerStatus } from '../api/types';
import DatentraegerWarnung, { betroffeneOrte } from './DatentraegerWarnung';

const admin = adminFixture({ anzeigename: 'Chef' });
const fuehrungskraft = benutzerFixture({ id: 2, anzeigename: 'Eva', org_rolle: 'fuehrungskraft' });

const UNVERSCHLUESSELT: DatentraegerStatus = {
  gesamt: 'unverschluesselt',
  warnung: true,
  extern_zugesichert: false,
  geprueft_um: '2026-10-09 12:00:00',
  orte: [
    { art: 'datenbank', pfad: '/var/lib/lifeline', wert: 'verschluesselt' },
    { art: 'sicherung', pfad: '/mnt/usb', wert: 'unbekannt', grund: 'netzlaufwerk' },
    { art: 'auslagerung', pfad: '/dev/sda3', wert: 'unverschluesselt' },
  ],
};

function setup(me: BenutzerAnzeige, status: DatentraegerStatus) {
  let abrufe = 0;
  let sitzung = 0;
  server.use(
    http.get('/api/auth/me', () => {
      sitzung += 1;
      return HttpResponse.json(me);
    }),
    http.get('/api/system/datentraeger', () => {
      abrufe += 1;
      return HttpResponse.json(status);
    }),
  );
  renderMitProviders(<DatentraegerWarnung />);
  return { abrufe: () => abrufe, sitzung: () => sitzung };
}

describe('DatentraegerWarnung (LFH-1100)', () => {
  it('nennt dem System-Admin jeden betroffenen Ort mit Pfad', async () => {
    setup(admin, UNVERSCHLUESSELT);
    const leiste = await screen.findByRole('status');
    expect(leiste).toHaveTextContent('Datenträger unverschlüsselt');
    expect(leiste).toHaveTextContent('Auslagerung');
    expect(leiste).toHaveTextContent('/dev/sda3');
    expect(leiste).toHaveTextContent('Sicherungen');
    expect(leiste).toHaveTextContent('Netzlaufwerk');
    // Der verschlüsselte Ort führt nicht zur Warnung und steht nicht darin.
    expect(leiste).not.toHaveTextContent('/var/lib/lifeline');
  });

  it('nennt „Verschlüsselung unbekannt“, wenn nichts unverschlüsselt ist', async () => {
    setup(admin, {
      ...UNVERSCHLUESSELT,
      gesamt: 'unbekannt',
      orte: [{ art: 'datenbank', pfad: '/data', wert: 'unbekannt', grund: 'virtuell' }],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Verschlüsselung unbekannt');
  });

  it('zeigt nichts ohne Warnung', async () => {
    const { abrufe } = setup(admin, {
      gesamt: 'verschluesselt',
      warnung: false,
      extern_zugesichert: false,
      orte: [{ art: 'datenbank', pfad: '/data', wert: 'verschluesselt' }],
    });
    await waitFor(() => expect(abrufe()).toBe(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('fragt für eine Führungskraft gar nicht erst', async () => {
    const { abrufe, sitzung } = setup(fuehrungskraft, UNVERSCHLUESSELT);
    // Erst mit geladener Sitzung stünde eine Abfrage an; danach einen Umlauf abwarten.
    await waitFor(() => expect(sitzung()).toBe(1));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(abrufe()).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('betroffeneOrte', () => {
  it('lässt mit Zusicherung externer Verschlüsselung „unbekannt“ weg', () => {
    const mitZusicherung = { ...UNVERSCHLUESSELT, extern_zugesichert: true };
    expect(betroffeneOrte(mitZusicherung).map((o) => o.art)).toEqual(['auslagerung']);
    expect(betroffeneOrte(UNVERSCHLUESSELT).map((o) => o.art)).toEqual([
      'sicherung',
      'auslagerung',
    ]);
  });
});
