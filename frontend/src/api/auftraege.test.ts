import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from './client';
import {
  auftragAbschlussCursor,
  ladeAuftragKennzahlen,
  listeAbgeschlosseneAuftraege,
  listeOffeneAuftraege,
} from './auftraege';
import type { Auftrag } from './types';

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

const auftrag = (over: Partial<Auftrag>): Auftrag =>
  ({
    id: 7,
    erstellt_at: '2026-10-12 08:00:00',
    vollzogen_at: null,
    abgenommen_at: null,
    ...over,
  }) as unknown as Auftrag;

describe('auftragAbschlussCursor', () => {
  it('ordnet wie der Server: aufgehoben, abgenommen, vollzogen, erstellt (LLH-1098)', () => {
    expect(auftragAbschlussCursor(auftrag({}))).toEqual({ zeit: '2026-10-12 08:00:00', id: 7 });
    expect(
      auftragAbschlussCursor(
        auftrag({ vollzogen_at: '2026-10-12 09:00:00', abgenommen_at: '2026-10-12 10:00:00' }),
      ),
    ).toEqual({ zeit: '2026-10-12 10:00:00', id: 7 });
    expect(
      auftragAbschlussCursor(
        auftrag({ vollzogen_at: '2026-10-12 09:00:00', aufgehoben_at: '2026-10-12 11:00:00' }),
      ),
    ).toEqual({ zeit: '2026-10-12 11:00:00', id: 7 });
  });
});
