import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import ZeichenWahlDialog from './ZeichenWahlDialog';
import type { FreiesZeichenUpdate } from '../../api/types';

/** Hält `offen` wie die Seite: Platzieren und Abbrechen schließen, „Weitere …“ öffnet neu. */
function MitSeite({ onPlatzieren }: { onPlatzieren: (spec: FreiesZeichenUpdate) => void }) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Weitere …
      </button>
      <ZeichenWahlDialog
        offen={offen}
        quelle="maus"
        onPlatzieren={(spec) => {
          setOffen(false);
          onPlatzieren(spec);
        }}
        onAbbrechen={() => setOffen(false)}
      />
    </>
  );
}

const grundzeichen = () => screen.getByRole('radiogroup', { name: 'Grundzeichen' });

describe('ZeichenWahlDialog (LLH-1038): der Zeichen-Picker aus „Weitere …“', () => {
  it('startet das Platzieren mit der Entwurfs-Spec (LFH-170)', () => {
    const onPlatzieren = vi.fn();
    renderMitProviders(<MitSeite onPlatzieren={onPlatzieren} />);
    const dialog = screen.getByRole('dialog', { name: 'Taktisches Zeichen' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Platzieren' }));
    // Startentwurf ist die taktische Formation, gesendet als Zeichenbeschreibung (LFH-836).
    expect(onPlatzieren).toHaveBeenCalledWith(
      expect.objectContaining({ zeichen_spec: '{"v":1,"spec":{"kind":"formation"}}' }),
    );
  });

  it('sperrt „Platzieren“ nach „Kein Grundzeichen“, bis ein Symbol gewählt ist (LFH-836)', () => {
    const onPlatzieren = vi.fn();
    renderMitProviders(<MitSeite onPlatzieren={onPlatzieren} />);
    fireEvent.click(within(grundzeichen()).getByRole('radio', { name: 'Kein Grundzeichen' }));
    const knopf = screen.getByRole('button', { name: 'Platzieren' });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    expect(onPlatzieren).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Symbol' })).getByRole('radio', {
        name: 'Angeschlagen',
      }),
    );
    expect(knopf).toBeEnabled();
    fireEvent.click(knopf);
    expect(onPlatzieren).toHaveBeenCalledWith(
      expect.objectContaining({
        zeichen_spec: '{"v":1,"freestanding":{"kind":"state","state":"damaged"}}',
      }),
    );
  });

  // Geschlossen wird beim Aufrufer (`offen`); das Schließen der Seite prüft `LagekartePage.test`.
  it('Enter auf einer Kachel platziert wie der Knopf (LFH-716)', () => {
    const onPlatzieren = vi.fn();
    renderMitProviders(<MitSeite onPlatzieren={onPlatzieren} />);
    const kachel = within(grundzeichen()).getByRole('radio', { name: 'Person' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    // Die Spec der Enter-Kachel, nicht der Entwurf von vorher.
    expect(onPlatzieren).toHaveBeenCalledWith(
      expect.objectContaining({ zeichen_spec: '{"v":1,"spec":{"kind":"person"}}' }),
    );
  });

  it('der Entwurf übersteht das Platzieren: der nächste Dialog beginnt beim letzten Zeichen', async () => {
    const onPlatzieren = vi.fn();
    renderMitProviders(<MitSeite onPlatzieren={onPlatzieren} />);
    const person = within(grundzeichen()).getByRole('radio', { name: 'Person' });
    person.focus();
    fireEvent.keyDown(person, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Weitere …' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Platzieren' }));
    expect(onPlatzieren).toHaveBeenLastCalledWith(
      expect.objectContaining({ zeichen_spec: '{"v":1,"spec":{"kind":"person"}}' }),
    );
  });

  it('Abbrechen platziert nichts', () => {
    const onPlatzieren = vi.fn();
    renderMitProviders(<MitSeite onPlatzieren={onPlatzieren} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onPlatzieren).not.toHaveBeenCalled();
  });
});

/** LLH-2010: ein Tipp neben den Dialog verwirft die Auswahl nicht (`frontend/AGENTS.md`, „Erfassungs-Norm“). */
describe('ZeichenWahlDialog — Maske (LLH-2010)', () => {
  it('die Maske schließt den Dialog nicht', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <ZeichenWahlDialog offen quelle="maus" onPlatzieren={vi.fn()} onAbbrechen={onAbbrechen} />,
    );
    const maske = screen
      .getByRole('dialog', { name: 'Taktisches Zeichen' })
      .closest('.ant-modal-wrap');
    // userEvent statt fireEvent: rc-dialog schließt nur nach mousedown UND click auf der Maske.
    await userEvent.click(maske as HTMLElement);
    expect(onAbbrechen).not.toHaveBeenCalled();
  });
});
