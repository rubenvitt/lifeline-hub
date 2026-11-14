import { afterEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import { spieleArchivEin } from './archivEinspielen';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('archivEinspielen-API (LLH-1711)', () => {
  const block = new File(['age'], 'einsatz-block-1.sqlite.age');

  it('schickt erst den Schlüssel als Text, dann die Passphrase, zuletzt den Block', () => {
    const anfragen = installiereXhrAttrappe();
    void spieleArchivEin({
      block,
      schluessel: { art: 'text', text: 'AGE-SECRET-KEY-1ABC' },
      passphrase: 'geheim',
    });
    const [xhr] = anfragen;
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe('/api/admin/archiv/einspielen');
    const fd = xhr.body as FormData;
    expect([...fd.keys()]).toEqual(['schluessel', 'passphrase', 'block']);
    expect(fd.get('schluessel')).toBe('AGE-SECRET-KEY-1ABC');
    expect(fd.get('block')).toBe(block);
  });

  it('schickt eine Schlüsseldatei unter schluessel_datei und lässt eine leere Passphrase weg', () => {
    const anfragen = installiereXhrAttrappe();
    const datei = new File(['AGE-SECRET-KEY-1ABC'], 'archiv.txt');
    void spieleArchivEin({ block, schluessel: { art: 'datei', datei }, passphrase: '' });
    const fd = anfragen[0].body as FormData;
    expect([...fd.keys()]).toEqual(['schluessel_datei', 'block']);
    expect(fd.get('schluessel_datei')).toBe(datei);
  });

  it('wartet 30 Minuten: das Zeitlimit umfasst Upload und Einspielen', () => {
    const anfragen = installiereXhrAttrappe();
    void spieleArchivEin({ block, schluessel: { art: 'text', text: 'k' } });
    expect(anfragen[0].timeout).toBe(1_800_000);
  });
});
