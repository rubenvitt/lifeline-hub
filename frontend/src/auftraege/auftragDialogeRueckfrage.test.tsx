import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { renderMitProviders as renderBasis } from '../test/utils';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { ChatNachricht, EtbEintragAnzeige, Meldung } from '../api/types';
import AuftragErteilenDialog from './AuftragErteilenDialog';
import AuftragErteilenModal from '../meldungen/AuftragErteilenModal';
import AuftragAusEtbModal from '../etb/AuftragAusEtbModal';
import HeraufstufenAuftragModal from '../chat/HeraufstufenAuftragModal';

vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

/**
 * LLH-1755: Die vier Auftragsdialoge laufen über die Pforte der Erfassungshülle. Die Maske schließt
 * nie, das Kreuz fragt bei Änderung nach, ein unbedient vorbelegter Dialog schließt still.
 */
interface Fall {
  name: string;
  vorbelegt: boolean;
  rendern: (onAbbruch: () => void) => ReactElement;
}

/** Escape läuft über die Tastatur-Ebenen; in der App umschließt sie `CommandPaletteProvider`. */
const renderMitProviders = (ui: ReactElement) =>
  renderBasis(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);

const gemeinsam = { abschnitte: [], einheiten: [], senden: false, onAnlegen: vi.fn() };

const FAELLE: Fall[] = [
  {
    name: 'AuftragErteilenDialog',
    vorbelegt: false,
    rendern: (onAbbruch) => (
      <AuftragErteilenDialog {...gemeinsam} offen einsatzId={5} onSchliessen={onAbbruch} />
    ),
  },
  {
    name: 'AuftragErteilenModal',
    vorbelegt: true,
    rendern: (onAbbruch) => (
      <AuftragErteilenModal
        {...gemeinsam}
        meldung={{ id: 3, absender: 'Florian 1', inhalt: 'Lage ruhig' } as Meldung}
        onAbbrechen={onAbbruch}
      />
    ),
  },
  {
    name: 'AuftragAusEtbModal',
    vorbelegt: true,
    rendern: (onAbbruch) => (
      <AuftragAusEtbModal
        {...gemeinsam}
        eintrag={{ id: 7, inhalt: 'Deich bei km 3 bricht' } as EtbEintragAnzeige}
        onAbbrechen={onAbbruch}
      />
    ),
  },
  {
    name: 'HeraufstufenAuftragModal',
    vorbelegt: true,
    rendern: (onAbbruch) => (
      <HeraufstufenAuftragModal
        {...gemeinsam}
        offen
        nachricht={{ id: 9, autor_name: 'Anna', inhalt: 'Tank anfordern' } as ChatNachricht}
        onAbbrechen={onAbbruch}
      />
    ),
  },
];

const kreuz = () => screen.getByRole('button', { name: /Close|Schliessen|Schließen/i });
const rueckfrageText = () => screen.queryByText(/gehen verloren\./);

describe.each(FAELLE)('$name — Rückfrage vor dem Verwerfen (LLH-1755)', (fall) => {
  it('die Maske schließt den Dialog nicht', async () => {
    const onAbbruch = vi.fn();
    renderMitProviders(fall.rendern(onAbbruch));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), ' Nord');
    const maske = document.querySelector<HTMLElement>('.ant-modal-wrap');
    expect(maske).not.toBeNull();
    await userEvent.click(maske!);
    expect(onAbbruch).not.toHaveBeenCalled();
    expect(rueckfrageText()).toBeNull();
  });

  it('das Kreuz fragt bei geändertem Auftragstext nach; „Verwerfen“ schließt', async () => {
    const onAbbruch = vi.fn();
    renderMitProviders(fall.rendern(onAbbruch));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), ' Nord');
    await userEvent.click(kreuz());
    expect(await screen.findByText(/gehen verloren\./)).toBeInTheDocument();
    expect(onAbbruch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(onAbbruch).toHaveBeenCalledTimes(1);
  });

  it('unbedient schließt das Kreuz still', async () => {
    const onAbbruch = vi.fn();
    renderMitProviders(fall.rendern(onAbbruch));
    await userEvent.click(kreuz());
    expect(onAbbruch).toHaveBeenCalledTimes(1);
    expect(rueckfrageText()).toBeNull();
  });

  it('Escape ohne Änderung schließt genau einmal', async () => {
    const onAbbruch = vi.fn();
    renderMitProviders(fall.rendern(onAbbruch));
    // Im Empfänger schließt Escape zuerst dessen offene Liste; der Dialog hört es im Textfeld.
    await waitFor(() => expect(screen.getByLabelText('Empfänger')).toHaveFocus());
    await userEvent.click(screen.getByLabelText('Auftrag / Was'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onAbbruch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(onAbbruch).toHaveBeenCalledTimes(1);
  });
});
