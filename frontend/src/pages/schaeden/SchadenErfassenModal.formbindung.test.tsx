import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { renderMitProviders } from '../../test/utils';
import SchadenErfassenModal from './SchadenErfassenModal';

/**
 * LFH-627: „Instance created by `useForm` is not connected to any Form element". Zwei Wege fassten
 * die Formularinstanz an, ohne dass ein `<Form>` hing:
 *  - der Öffnen-Effekt setzte den gemerkten Ort, bevor antds `Modal` sein `<Form>` eingehängt
 *    hatte (fällt nur über den echten Scheduler auf, `act` arbeitet alles in einem Zug ab);
 *  - der Einsatzwechsel rief `resetFields()`, auch wenn der Dialog nie offen war.
 *
 * **Eigene Datei, und das ist Absicht:** `@rc-component/util` gibt dieselbe Warnung je
 * Modulinstanz nur EINMAL aus (`warningOnce`). Vitest isoliert die Module je Testdatei; die
 * beiden Fälle unten belegen sich je mit `-t` einzeln.
 */

const naechsterMakrotask = () => new Promise((r) => setTimeout(r, 0));

function unverbundenWarnungen(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is not connected'));
}

let steuerung: { oeffne: () => void; wechsleEinsatz: (id: number) => void } = {
  oeffne: () => {},
  wechsleEinsatz: () => {},
};

function Huelle() {
  const [offen, setOffen] = useState(false);
  const [einsatzId, setEinsatzId] = useState(1);
  steuerung = { oeffne: () => setOffen(true), wechsleEinsatz: setEinsatzId };
  return (
    <SchadenErfassenModal
      open={offen}
      onClose={() => setOffen(false)}
      einsatzId={einsatzId}
      orgId={1}
      orgName="Eigene Organisation"
    />
  );
}

/** Stößt das Öffnen außerhalb von `act` an, wie es eine Netzantwort oder ein Effekt täte. */
async function oeffneUeberDenScheduler() {
  const umgebung = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  umgebung.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    steuerung.oeffne();
    for (let i = 0; i < 20; i++) await naechsterMakrotask();
  } finally {
    umgebung.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('SchadenErfassenModal · Formularbindung (LFH-627)', () => {
  it('setzt den gemerkten Ort erst, wenn das Formular eingehängt ist', async () => {
    sessionStorage.setItem('lfh:erfassung:1:schaden:ort', 'Marktplatz');
    const spy = vi.spyOn(console, 'error');
    renderMitProviders(<Huelle />);

    await oeffneUeberDenScheduler();

    await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue('Marktplatz'));
    expect(unverbundenWarnungen(spy)).toEqual([]);
  });

  it('ein Einsatzwechsel bei nie geöffnetem Dialog fasst das Formular nicht an', async () => {
    const spy = vi.spyOn(console, 'error');
    renderMitProviders(<Huelle />);

    act(() => steuerung.wechsleEinsatz(2));
    await act(naechsterMakrotask);

    expect(unverbundenWarnungen(spy)).toEqual([]);
  });
});
