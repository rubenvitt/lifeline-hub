import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import HeraufstufenModal from './HeraufstufenModal';
import type { Anhang, ChatNachricht } from '../api/types';

function anhang(id: number, dateiname: string): Anhang {
  return {
    id,
    einsatz_id: 7,
    dateiname,
    mime: 'image/jpeg',
    groesse: 2048,
    hochgeladen_von: 1,
    erstellt_at: '2026-06-10 10:00:00',
  };
}

function nachricht(anhaenge: Anhang[] = []): ChatNachricht {
  return {
    id: 1,
    einsatz_id: 7,
    kanal_id: 1,
    autor_id: 1,
    autor_name: 'Max',
    inhalt: 'Deich instabil',
    erstellt_at: '2026-06-10 10:00:00',
    bearbeitet_at: null,
    geloescht_at: null,
    etb_eintrag_id: null,
    auftrag_id: null,
    bezug_typ: null,
    bezug_id: null,
    anhaenge,
  };
}

function oeffne(n: ChatNachricht) {
  const onHeraufstufen = vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <HeraufstufenModal
      offen
      nachricht={n}
      senden={false}
      onAbbrechen={vi.fn()}
      onHeraufstufen={onHeraufstufen}
    />,
  );
  return onHeraufstufen;
}

const HINWEIS = /im Tagebuch unveränderlich/;

describe('HeraufstufenModal', () => {
  it('übernimmt den Nachrichtentext und bestätigt mit Typ + Text', async () => {
    const onHeraufstufen = oeffne(nachricht());
    expect(screen.getByDisplayValue('Deich instabil')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Heraufstufen' }));
    expect(onHeraufstufen).toHaveBeenCalledWith('meldung', 'Deich instabil', []);
  });

  // Erfassungs-Norm (frontend/AGENTS.md): Ein `Select` schluckt Enter, also muss der Knopf im
  // `<form>` liegen und die antd-Fußzeile fehlen.
  it('liegt auf der Erfassungshülle: Knopf im Formular, keine Fußzeile', () => {
    oeffne(nachricht());
    const knopf = screen.getByRole('button', { name: 'Heraufstufen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('zeigt ohne Anhang weder Auswahl noch Hinweis', () => {
    oeffne(nachricht());
    expect(screen.queryByRole('group', { name: /Anhänge übernehmen/ })).toBeNull();
    expect(screen.queryByText(HINWEIS)).toBeNull();
  });

  // LFH-700: übernommen wird nur, was die Person gewählt lässt.
  it('sendet genau die gewählten Anhänge', async () => {
    const onHeraufstufen = oeffne(nachricht([anhang(11, 'deich.jpg'), anhang(12, 'privat.jpg')]));
    expect(screen.getByText(HINWEIS)).toBeInTheDocument();
    const gruppe = screen.getByRole('group', { name: /Anhänge übernehmen/ });
    expect(gruppe).toBeInTheDocument();
    const privat = screen.getByRole('checkbox', { name: /privat\.jpg/ });
    expect(privat).toBeChecked();
    await userEvent.click(privat);

    await userEvent.click(screen.getByRole('button', { name: 'Heraufstufen' }));
    expect(onHeraufstufen).toHaveBeenCalledWith('meldung', 'Deich instabil', [11]);
  });

  it('wählt bei elf Anhängen zehn vor und lässt keinen elften zu', async () => {
    const elf = Array.from({ length: 11 }, (_, i) => anhang(100 + i, `f${i}.jpg`));
    const onHeraufstufen = oeffne(nachricht(elf));

    const kaestchen = screen.getAllByRole('checkbox');
    expect(kaestchen).toHaveLength(11);
    expect(kaestchen.filter((k) => (k as HTMLInputElement).checked)).toHaveLength(10);
    const elfter = screen.getByRole('checkbox', { name: /f10\.jpg/ });
    expect(elfter).not.toBeChecked();
    // `Form.useWatch` meldet die Vorbelegung einen Takt später.
    await waitFor(() => expect(elfter).toBeDisabled());

    // Eine abgewählte Datei gibt den Platz frei.
    await userEvent.click(screen.getByRole('checkbox', { name: /f0\.jpg/ }));
    expect(elfter).toBeEnabled();
    await userEvent.click(elfter);
    await userEvent.click(screen.getByRole('button', { name: 'Heraufstufen' }));
    expect(onHeraufstufen).toHaveBeenCalledWith(
      'meldung',
      'Deich instabil',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
    );
  });
});
