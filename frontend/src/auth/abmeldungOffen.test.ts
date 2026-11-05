/**
 * LLH-1535: der Merker einer gescheiterten Abmeldung gehört zu genau einem Vorgang. Ein noch
 * laufendes Nachfragen der Kennung oder Nachholen der Abmeldung ändert oder löscht keinen
 * Merker, den ein späteres gescheitertes Abmelden angelegt hat.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { MeAntwort } from '../api/types';
import { server } from '../test/server';
import { sicherLesen } from '../lib/sichererSpeicher';
import {
  beginneAbmeldung,
  holeAbmeldungNach,
  istAufgegebeneSitzung,
  merkeOffeneAbmeldung,
  vergissOffeneAbmeldung,
} from './abmeldungOffen';

const anna = {
  id: 1,
  anzeigename: 'Anna Admin',
  benutzername: 'anna',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
} as MeAntwort;

const merker = () =>
  JSON.parse(sicherLesen('lfh:abmeldung-offen') ?? 'null') as {
    sitzung: string | null;
  } | null;

/** Eine Antwort, die erst auf Freigabe herausgeht. */
function gehalten() {
  let freigeben: () => void = () => {};
  const gesperrt = new Promise<void>((r) => (freigeben = r));
  return { gesperrt, freigeben: () => freigeben() };
}

afterEach(() => vergissOffeneAbmeldung());

describe('Merker einer gescheiterten Abmeldung (LLH-1535)', () => {
  it('eine veraltete /me-Antwort überschreibt keinen neueren Merker', async () => {
    const alt = gehalten();
    const neu = gehalten();
    let aufrufe = 0;
    server.use(
      http.get('/api/auth/me', async () => {
        aufrufe++;
        if (aufrufe === 1) {
          await alt.gesperrt;
          return HttpResponse.json({ ...anna, sitzung: 'k-alt' });
        }
        await neu.gesperrt;
        return HttpResponse.json({ ...anna, sitzung: 'k-neu' });
      }),
    );
    merkeOffeneAbmeldung(anna);
    await waitFor(() => expect(aufrufe).toBe(1));
    // Inzwischen neu angemeldet und wieder gescheitert abgemeldet, wieder ohne Kennung im Tab.
    merkeOffeneAbmeldung(anna);
    await waitFor(() => expect(aufrufe).toBe(2));
    // Die Antwort zur alten Sitzung kommt zuerst.
    alt.freigeben();
    await new Promise((r) => setTimeout(r, 20));
    neu.freigeben();
    await waitFor(() => expect(merker()?.sitzung).toBe('k-neu'));
    expect(istAufgegebeneSitzung({ ...anna, sitzung: 'k-neu' })).toBe(true);
  });

  it('ein laufendes Nachholen löscht keinen währenddessen angelegten Merker', async () => {
    const halt = gehalten();
    let gerufen = false;
    server.use(
      http.post('/api/auth/logout', async () => {
        gerufen = true;
        await halt.gesperrt;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    merkeOffeneAbmeldung({ ...anna, sitzung: 'k1' });
    const lauf = holeAbmeldungNach({ ...anna, sitzung: 'k1' });
    await waitFor(() => expect(gerufen).toBe(true));
    merkeOffeneAbmeldung({ ...anna, sitzung: 'k2' });
    halt.freigeben();
    await lauf;
    expect(merker()?.sitzung).toBe('k2');
  });

  it('ein gelungenes Nachholen löscht den eigenen Merker', async () => {
    server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })));
    merkeOffeneAbmeldung({ ...anna, sitzung: 'k1' });
    await holeAbmeldungNach({ ...anna, sitzung: 'k1' });
    expect(merker()).toBeNull();
  });

  it('das Nachholen nennt die gesehene Sitzung; eine neue Anmeldung beendet es nicht (412)', async () => {
    let koepfe: Headers | undefined;
    server.use(
      http.post('/api/auth/logout', ({ request }) => {
        koepfe = request.headers;
        // Inzwischen gehört das Cookie einer neuen Sitzung.
        return HttpResponse.json({ error: 'fremd' }, { status: 412 });
      }),
    );
    merkeOffeneAbmeldung({ ...anna, sitzung: 'k1' });
    await holeAbmeldungNach({ ...anna, sitzung: 'k1' });
    expect(koepfe?.get('X-Erwartete-Sitzung')).toBe('k1');
    expect(koepfe?.get('X-Erwarteter-Benutzer-Id')).toBe('1');
    // Der Merker ist überholt: die neue Sitzung wird normal übernommen.
    expect(merker()).toBeNull();
  });

  it('eine 412 auf eine veraltete Sitzung vergisst keinen Merker ohne Kennung', async () => {
    server.use(
      http.post('/api/auth/logout', () => HttpResponse.json({ error: 'fremd' }, { status: 412 })),
    );
    // Der Merker nennt keine Kennung; die gesehene Sitzung k-alt ist nicht mehr die des Cookies.
    beginneAbmeldung(anna);
    await holeAbmeldungNach({ ...anna, sitzung: 'k-alt' });
    expect(merker()).toEqual(expect.objectContaining({ sitzung: null }));
  });

  it('ohne Kennung der gesehenen Sitzung unterbleibt das Nachholen', async () => {
    let gerufen = false;
    server.use(
      http.post('/api/auth/logout', () => {
        gerufen = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    merkeOffeneAbmeldung({ ...anna, sitzung: 'k1' });
    // Nur an den Benutzer gebunden träfe der Ruf auch eine neue Sitzung derselben Person.
    await holeAbmeldungNach(anna);
    expect(gerufen).toBe(false);
    expect(merker()?.sitzung).toBe('k1');
  });
});
