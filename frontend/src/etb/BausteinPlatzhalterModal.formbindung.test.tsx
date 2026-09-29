import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EtbBaustein } from '../api/types';
import { renderMitProviders } from '../test/utils';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';
import { einsatzFixture } from '../test/fixtures';

/**
 * LFH-624: „Instance created by `useForm` is not connected to any Form element". Das Modal
 * darf beim Einhängen nicht `form.resetFields()` rufen: antds `Modal` rendert sein `<Form>`
 * erst beim ersten Öffnen, und rc-field-form prüft einen Makrotask später, ob die Instanz an
 * einem `<Form>` hängt.
 *
 * **Eigene Datei, und das ist Absicht:** `@rc-component/util` gibt dieselbe Warnung je
 * Modulinstanz nur EINMAL aus (`warningOnce`). In einer Datei mit weiteren Tests hätte ein
 * früherer Test sie schon verbraucht, und dieser bliebe auch mit dem Fehler grün. Vitest
 * isoliert die Module je Testdatei.
 */

const einsatz = einsatzFixture({ bezeichnung: 'Test' });

function baustein(over: Partial<EtbBaustein> = {}): EtbBaustein {
  return {
    id: 1,
    label: 'B',
    typ: 'meldung',
    inhalt: 'Bereitstellung',
    meldeweg: null,
    veranlassung: null,
    sortier: 0,
    ...over,
  };
}

/** Die Prüfung von rc-field-form läuft in einem `setTimeout(…, 0)` nach dem Aufruf. */
const naechsterMakrotask = () => new Promise((r) => setTimeout(r, 0));

function unverbundenWarnungen(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is not connected'));
}

afterEach(() => vi.restoreAllMocks());

describe('BausteinPlatzhalterModal · Formularbindung (LFH-624)', () => {
  it('ein geschlossener Dialog fasst sein Formular nicht an', async () => {
    const spy = vi.spyOn(console, 'error');
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={null}
        einsatz={einsatz}
        onEinsetzen={vi.fn()}
        onAbbrechenAll={vi.fn()}
      />,
    );
    await naechsterMakrotask();
    expect(unverbundenWarnungen(spy)).toEqual([]);
  });

  it('ein Baustein ohne Platzhalter wird eingesetzt, ohne das Formular anzufassen', async () => {
    const spy = vi.spyOn(console, 'error');
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein()}
        einsatz={einsatz}
        onEinsetzen={onEinsetzen}
        onAbbrechenAll={vi.fn()}
      />,
    );
    await naechsterMakrotask();
    expect(onEinsetzen).toHaveBeenCalledTimes(1);
    expect(unverbundenWarnungen(spy)).toEqual([]);
  });
});
