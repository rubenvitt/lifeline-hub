import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from './client';
import {
  ladeAuftragKennzahlen,
  listeAbgeschlosseneAuftraege,
  listeOffeneAuftraege,
} from './auftraege';

/** Die Suche der Aufträge geht an den Server (`q`, Spec `auftraege-befehle`, D9). */
describe('Auftragsboard — Suchbegriff als `q`', () => {
  afterEach(() => vi.restoreAllMocks());

  function urls(aufruf: () => Promise<unknown>) {
    const get = vi.spyOn(client, 'apiGet').mockResolvedValue([] as never);
    void aufruf();
    return get.mock.calls.map(([url]) => String(url));
  }

  it('hängt `q` an Liste, Seite und Kennzahlen', () => {
    expect(urls(() => listeOffeneAuftraege(5, { suche: 'H12 #4' }))[0]).toContain('q=H12+%234');
    expect(urls(() => listeAbgeschlosseneAuftraege(5, { suche: 'H12' }))[0]).toContain('q=H12');
    expect(urls(() => ladeAuftragKennzahlen(5, { suche: 'H12' }))[0]).toContain('q=H12');
  });

  it('ohne Begriff kein `q`', () => {
    expect(urls(() => listeOffeneAuftraege(5, { suche: '' }))[0]).not.toContain('q=');
    expect(urls(() => ladeAuftragKennzahlen(5))[0]).not.toContain('q=');
  });
});
