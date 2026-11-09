import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { warteAufMenueFokus } from '../test/menue';
import type { Auftrag } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import AuftragKarte from './AuftragKarte';

/**
 * Zeitspalte der Auftragskarte (LFH-972): sie zeigt die ERTEILUNGSZEIT wie der Überblick, nicht
 * den Erfassungszeitpunkt. Ein über Funk erteilter, nachträglich erfasster Auftrag trüge sonst auf
 * beiden Seiten zwei verschiedene Uhrzeiten.
 *
 * Die Zone steht ausdrücklich: ohne sie gälte die Maschinenzone, und der Test hinge an `TZ`.
 */

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 31,
  einsatz_id: 5,
  lfd_nr: 9,
  auftrag_text: 'Stromerzeuger 8 kVA bereitstellen',
  absicht: null,
  lage: null,
  ort: null,
  zeit: null,
  mittel: null,
  verbindung: null,
  sicherheit: null,
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  // Mündlich um 22:01 Ortszeit erteilt, erst um 23:26 erfasst (Sommerzeit, UTC+2).
  erteilt_at: '2026-06-11 20:01:00',
  in_arbeit_at: null,
  vollzugsmeldung: null,
  abgenommen_at: null,
  abgenommen_von_id: null,
  etb_anordnung_id: 5,
  quell_etb_eintrag_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-11 21:26:00',
  vollzug_status: 'offen',
  vollzogen_at: null,
  vollzogen_von_id: null,
  empfaenger_anzahl: 0,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  berichtigbar: true,
  empfaenger: [],
  ...over,
});

function renderKarte(a: Auftrag) {
  return render(
    <AntApp>
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <MemoryRouter>
          <AuftragKarte auftrag={a} einsatzId={5} />
        </MemoryRouter>
      </AnzeigeKonventionenProvider>
    </AntApp>,
  );
}

describe('AuftragKarte — Erteilungszeit (LFH-972)', () => {
  it('zeigt die Erteilungszeit, nicht den Erfassungszeitpunkt, und beschriftet sie sichtbar', () => {
    const { container } = renderKarte(auftrag());
    const spalte = container.querySelector<HTMLElement>('[data-lfh="komm-karte-zeit"]')!;
    expect(within(spalte).getByText('112201')).toBeInTheDocument();
    expect(within(spalte).queryByText('112326')).toBeNull();
    // Die Beschriftung steht im Text, nicht nur als Tooltip: auf Touch gibt es kein Hover.
    expect(within(spalte).getByText('erteilt')).toBeVisible();
  });

  it('trägt im Klappkopf „Auftragsdetails", nicht „Befehlsdetails"', () => {
    renderKarte(auftrag({ ort: 'Deichkrone Süd' }));
    expect(screen.getByText('Auftragsdetails (Schema)')).toBeInTheDocument();
    expect(screen.queryByText(/Befehlsdetails/)).toBeNull();
  });
});

/** LLH-1091: die Lesefassung folgt dem Formular (FwDV 100), leere Felder fallen weg. */
describe('AuftragKarte — Schema in Formularfolge (LLH-1091)', () => {
  const etiketten = () =>
    [...document.querySelectorAll('.ant-descriptions-item-label')].map((l) => l.textContent);

  it('zeigt Mittel, Weg und Absicht in Formularfolge, danach die Erteilzeit', async () => {
    renderKarte(
      auftrag({ absicht: 'Überflutung verhindern', mittel: 'Sandsäcke', weg: 'über B 3' }),
    );
    await userEvent.click(screen.getByText('Auftragsdetails (Schema)'));
    expect(etiketten()).toEqual(['Mittel', 'Weg', 'Absicht', 'Erteilt am']);
    expect(screen.getByText('über B 3')).toBeInTheDocument();
  });

  it('führt einen Bestandsauftrag: Ort als „Ziel / Ort“, Absicht als „Absicht“', async () => {
    renderKarte(auftrag({ ort: 'Halle 3', absicht: 'Brand eindämmen' }));
    await userEvent.click(screen.getByText('Auftragsdetails (Schema)'));
    expect(etiketten()).toEqual(['Ziel / Ort', 'Absicht', 'Erteilt am']);
  });
});

describe('AuftragKarte — Kontextmenü (LLH-1598)', () => {
  const offenesKontextmenue = async () => {
    await warteAufMenueFokus();
    const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
      (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
    );
    expect(offen).toHaveLength(1);
    return offen[0].querySelector<HTMLElement>('[role="menu"]')!;
  };
  const rechtsklick = (el: Element) =>
    fireEvent.contextMenu(el, { clientX: 20, clientY: 20, button: 2 });
  const zeige = (a: Auftrag, props: Partial<ComponentProps<typeof AuftragKarte>>) =>
    render(
      <AntApp>
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <MemoryRouter>
            <AuftragKarte auftrag={a} einsatzId={5} darfSchreiben {...props} />
          </MemoryRouter>
        </AnzeigeKonventionenProvider>
      </AntApp>,
    );

  it('offener Auftrag: Knöpfe vor Berichtigen, „Auftrag aufheben“ rot hinter dem Trenner', async () => {
    zeige(auftrag(), {
      onInArbeit: vi.fn(),
      onVollzugMelden: vi.fn(),
      onBerichtigen: vi.fn(),
      onAufheben: vi.fn(),
    });
    expect(rechtsklick(screen.getByText('Stromerzeuger 8 kVA bereitstellen'))).toBe(false);
    const menue = await offenesKontextmenue();
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Auftrag #9');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Bearbeitung beginnen', 'Vollzug melden', 'Berichtigen', 'Auftrag aufheben']);
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
  });

  it('„Abnehmen“ fragt im Dialog nach wie sein Knopf', async () => {
    const onAbnehmen = vi.fn();
    zeige(auftrag({ bearbeitungsstatus: 'vollzogen', vollzug_status: 'vollzogen' }), {
      onAbnehmen,
    });
    rechtsklick(screen.getByText('Stromerzeuger 8 kVA bereitstellen'));
    await userEvent.click(
      within(await offenesKontextmenue()).getByRole('menuitem', { name: 'Abnehmen' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Auftrag abnehmen?').length).toBeGreaterThan(0);
    expect(onAbnehmen).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag abnehmen' }));
    expect(onAbnehmen).toHaveBeenCalledWith(31);
  });

  it('ohne Schreibrecht bleibt das Browsermenü', () => {
    zeige(auftrag(), { darfSchreiben: false, onInArbeit: vi.fn() });
    expect(rechtsklick(screen.getByText('Stromerzeuger 8 kVA bereitstellen'))).toBe(true);
  });
});
