import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { renderMitProviders } from '../test/utils';
import PersonErfassungModal, { type ErfassungsModus } from './PersonErfassungModal';

/**
 * LFH-627: „Instance created by `useForm` is not connected to any Form element". Der Dialog
 * setzte den gemerkten Antreffort im Öffnen-Effekt, bevor antds `Modal` sein `<Form>` eingehängt
 * hatte. Innerhalb von `act` fällt das nicht auf, weil `act` alles in einem Zug abarbeitet; über
 * den echten Scheduler (Deeplink `?neu=1`, Netzantwort) prüft rc-field-form einen Makrotask
 * später und findet kein `<Form>`.
 *
 * **Eigene Datei, und das ist Absicht:** `@rc-component/util` gibt dieselbe Warnung je
 * Modulinstanz nur EINMAL aus (`warningOnce`). Vitest isoliert die Module je Testdatei.
 */

const naechsterMakrotask = () => new Promise((r) => setTimeout(r, 0));

function unverbundenWarnungen(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is not connected'));
}

let oeffne: () => void = () => {};

function Huelle() {
  const [modus, setModus] = useState<ErfassungsModus | null>(null);
  oeffne = () => setModus('schnell');
  return (
    <PersonErfassungModal
      einsatzId={1}
      modus={modus}
      isPending={false}
      onErfassen={vi.fn()}
      onFertig={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

/** Stößt das Öffnen außerhalb von `act` an, wie es eine Netzantwort oder ein Effekt täte. */
async function oeffneUeberDenScheduler() {
  const umgebung = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  umgebung.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    oeffne();
    for (let i = 0; i < 20; i++) await naechsterMakrotask();
  } finally {
    umgebung.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('PersonErfassungModal · Formularbindung (LFH-627)', () => {
  it('setzt den gemerkten Antreffort erst, wenn das Formular eingehängt ist', async () => {
    sessionStorage.setItem('lfh:erfassung:1:person:antreff_ort', 'Turnhalle');
    const spy = vi.spyOn(console, 'error');
    renderMitProviders(<Huelle />);

    await oeffneUeberDenScheduler();

    await waitFor(() => expect(screen.getByLabelText(/Antreffort/)).toHaveValue('Turnhalle'));
    expect(unverbundenWarnungen(spy)).toEqual([]);
  });
});
