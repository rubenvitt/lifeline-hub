import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import MeldungKarte from './MeldungKarte';
import type { Meldung } from '../api/types';

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1, einsatz_id: 7, lfd_nr: 1, absender: 'Florian Nord 1', empfaenger: 'ELW 1',
  meldeweg: 'funk', inhalt: 'Deich instabil', meldungsart: 'sofortmeldung', prioritaet: 'normal', richtung: 'intern',
  status: 'neu', bearbeiter_id: null, bearbeiter_name: null, lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00', eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7, auftrag_id: null, erfasst_von_id: 1, erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null, ist_offen: true, erledigt_at: null,
  bestaetigung_pflicht: false, bestaetigung_frist_at: null, eskaliert: false,
  bestaetigt_at: null, bestaetigt_von_id: null, bestaetigt_von_name: null,
  ist_bestaetigt: false, ist_ueberfaellig: false, ...over,
});

function renderKarte(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/**
 * Greift das GEÖFFNETE Dropdown-Portal. antd lässt die Portale geschlossener Dropdowns
 * im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden` — deshalb
 * zusätzlich über `pointerEvents` filtern und genau einen Treffer verlangen.
 */
async function oeffneAktionsmenue(lfdNr = 1): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Meldung ${lfdNr}` }));
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
    .filter((d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none');
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Das Aktionsmenü zu Meldung ${lfdNr} ließ sich nicht öffnen`);
  return menue;
}

/** Die Worst-Case-Meldung aus dem AK: neu · bestätigungspflichtig unbestätigt ·
 *  nicht lagerelevant · kein Auftrag → alle sechs Aktionen stehen zur Verfügung. */
const schlimmstenfalls = () => meldung({
  status: 'neu', bestaetigung_pflicht: true, ist_bestaetigt: false,
  lagerelevant: false, auftrag_id: null,
});

const alleCallbacks = () => ({
  darfSchreiben: true,
  onStatus: vi.fn(), onLagerelevant: vi.fn(), onBestaetigen: vi.fn(), onAuftragErteilen: vi.fn(),
});

describe('MeldungKarte — Auftrags-Deeplink (F36/LFH-257)', () => {
  it('verlinkt den ausgelösten Auftrag mit ?auftrag=<id>-Selektion', () => {
    renderKarte(<MeldungKarte meldung={meldung({ auftrag_id: 99 })} einsatzId={7} />);
    const link = screen.getByRole('link', { name: /Auftrag/ });
    expect(link).toHaveAttribute('href', '/einsaetze/7/auftraege?auftrag=99');
  });

  it('rendert ohne ausgelösten Auftrag keinen Auftrags-Deeplink', () => {
    renderKarte(<MeldungKarte meldung={meldung({ auftrag_id: null })} einsatzId={7} />);
    expect(screen.queryByRole('link', { name: /Auftrag/ })).toBeNull();
  });
});

describe('MeldungKarte — Aktionsbündelung (LFH-372/B5k)', () => {
  it('zeigt im Worst-Case höchstens zwei Aktionen im Kartenkörper, den Rest hinter einem Trigger', async () => {
    const cb = alleCallbacks();
    const { container } = renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const karte = container.querySelector<HTMLElement>('[data-meldung-id="1"]')!;
    // Im Kartenkörper: die zwei Aktionen PLUS der eine Trigger — mehr nicht.
    const knoepfe = within(karte).getAllByRole('button');
    expect(knoepfe.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Bestätigen', 'Sichten', 'Aktionen zu Meldung 1',
    ]);
    // Die übrigen vier sind über GENAU EINEN Trigger erreichbar.
    const menue = await oeffneAktionsmenue();
    expect(within(menue).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'In Bearbeitung', 'Erledigt', 'An Lage übergeben', 'Auftrag erteilen',
    ]);
  });

  it('löst „Bestätigen" über den sichtbaren Knopf aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    // Der OK-Knopf des Popconfirm heisst ebenfalls „Bestätigen" — der letzte ist seiner.
    const knoepfe = await screen.findAllByRole('button', { name: 'Bestätigen' });
    await userEvent.click(knoepfe[knoepfe.length - 1]);
    expect(cb.onBestaetigen).toHaveBeenCalledWith(1);
  });

  it('löst den sichtbaren Statusschritt ohne Rückfrage aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    // Kein Popconfirm mehr (LFH-378, umkehrbar): der Klick schaltet unmittelbar.
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'gesichtet');
  });

  it('löst „In Bearbeitung" aus dem Menü aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /In Bearbeitung/ }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'in_bearbeitung');
  });

  it('löst „Erledigt" aus dem Menü erst nach der Rückfrage aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Erledigt/ }));
    // Ohne Bestätigung passiert nichts — die Rückfrage ist kein Schmuck.
    expect(cb.onStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'erledigt');
  });

  it('löst „An Lage übergeben" und „Auftrag erteilen" aus dem Menü aus', async () => {
    const cb = alleCallbacks();
    const m = schlimmstenfalls();
    const { unmount } = renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /An Lage übergeben/ }));
    expect(cb.onLagerelevant).toHaveBeenCalledWith(1);
    unmount();
    renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /Auftrag erteilen/ }));
    expect(cb.onAuftragErteilen).toHaveBeenCalledWith(m);
  });

  it('führt bei „in_bearbeitung" „Erledigt" sichtbar — und dann NICHT mehr im Menü', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={meldung({ status: 'in_bearbeitung' })} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'erledigt');
    const menue = await oeffneAktionsmenue();
    expect(within(menue).queryByRole('menuitem', { name: /Erledigt/ })).not.toBeInTheDocument();
  });

  it('erreicht den Trigger mit der Tastatur', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const trigger = screen.getByRole('button', { name: 'Aktionen zu Meldung 1' });
    trigger.focus();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('zeigt ohne Schreibrecht weder Aktionen noch Trigger', () => {
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} darfSchreiben={false} />);
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sichten' })).not.toBeInTheDocument();
  });
});
