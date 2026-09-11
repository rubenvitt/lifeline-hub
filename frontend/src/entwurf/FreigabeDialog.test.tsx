import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import FreigabeDialog, { freigabeGrund } from './FreigabeDialog';
import { ApiError } from '../api/client';

/**
 * LFH-535 — der Träger eines gescheiterten Zustandsübergangs.
 *
 * Die Fallunterscheidung steht als reine Funktion daneben, damit sie ohne Render prüfbar
 * ist (Muster `fehlerText`/`bedienzielStil`). Die Aussage, die ein Primitiv auffliegen
 * lässt, das immer etwas liefert, ist die über den LEERFALL.
 */
describe('freigabeGrund (rein)', () => {
  it('liefert ohne Fehler NICHTS', () => {
    expect(freigabeGrund(null, null)).toBeNull();
    expect(freigabeGrund(undefined, undefined)).toBeNull();
  });

  it('benennt den Speicher-Vorlauf und den Zustandsübergang VERSCHIEDEN', () => {
    const s = freigabeGrund(new ApiError(503, 'Dienst weg'), null);
    const f = freigabeGrund(null, new ApiError(422, 'Abschnitt leer'));
    expect(s?.titel).toBe('Nicht gespeichert');
    expect(f?.titel).toBe('Freigabe fehlgeschlagen');
    // Zwei Überschriften, nicht eine: sie sagen der Person Verschiedenes darüber, was ihr
    // Entwurf jetzt IST — gespeichert und abgelehnt, oder gar nicht erst gespeichert.
    expect(s?.titel).not.toBe(f?.titel);
  });

  /**
   * Der Vorrang ist die Reihenfolge, nicht Geschmack: scheitert der Vorlauf, läuft die
   * Freigabe gar nicht erst — ein dann noch stehender `freigabeFehler` stammt aus einem
   * FRÜHEREN Versuch und wäre der veraltete von beiden.
   */
  it('zeigt bei zwei stehenden Gründen den Speicherfehler', () => {
    const speichern = new ApiError(503, 'Dienst weg');
    const grund = freigabeGrund(speichern, new ApiError(422, 'Abschnitt leer'));
    expect(grund?.fehler).toBe(speichern);
    expect(grund?.titel).toBe('Nicht gespeichert');
  });
});

function renderDialog(over: Partial<Parameters<typeof FreigabeDialog>[0]> = {}) {
  const onAbbrechen = vi.fn();
  const onFreigeben = vi.fn();
  const ergebnis = render(
    <AntApp>
      <FreigabeDialog
        offen
        titel="Befehl freigeben?"
        warnung="Die Freigabe ist endgültig und unveränderlich."
        speicherFehler={null}
        freigabeFehler={null}
        laeuft={false}
        onAbbrechen={onAbbrechen}
        onFreigeben={onFreigeben}
        {...over}
      />
    </AntApp>,
  );
  return { ...ergebnis, onAbbrechen, onFreigeben };
}

describe('FreigabeDialog (LFH-535)', () => {
  it('trägt den Grund IM Dialog, nicht in einem Toast', async () => {
    renderDialog({ freigabeFehler: new ApiError(422, 'Abschnitt „Auftrag" ist leer') });
    const dialog = await screen.findByRole('dialog', { name: 'Befehl freigeben?' });
    const treffer = within(dialog).getByText('Abschnitt „Auftrag" ist leer');
    // Die Aussage, die den Umbau trägt: der Grund hängt NICHT in der Message-Queue mit
    // ihrer eigenen Lebensdauer von rund drei Sekunden (H14).
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(within(dialog).getByText('Freigabe fehlgeschlagen')).toBeInTheDocument();
  });

  it('zeigt ohne Fehler keinen Alert, aber die Warnung (Gegenaussage)', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Befehl freigeben?' });
    expect(within(dialog).getByText(/endgültig und unveränderlich/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('meldet Abbrechen und Freigeben getrennt', async () => {
    const { onAbbrechen, onFreigeben } = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Befehl freigeben?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));
    expect(onFreigeben).toHaveBeenCalledTimes(1);
    expect(onAbbrechen).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
  });

  /**
   * Escape muss abbrechen — `onCancel` bedient beim antd-`Modal` Schliesskreuz UND Escape.
   * Ohne den Weg stünde der Dialog ohne Tastaturausgang da.
   */
  it('bricht auch per Escape ab', async () => {
    const { onAbbrechen } = renderDialog();
    await screen.findByRole('dialog', { name: 'Befehl freigeben?' });
    await userEvent.keyboard('{Escape}');
    expect(onAbbrechen).toHaveBeenCalled();
  });
});
