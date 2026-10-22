import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import MeldungKarte from './MeldungKarte';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { formatZeit, DEFAULT_KONVENTIONEN } from '../anzeige/format';
import { mitProzessZone } from '../test/prozessZone';
import { oeffne, optionenVon, waehle } from '../test/auswahlListe';
import type { Meldung } from '../api/types';

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1,
  einsatz_id: 7,
  lfd_nr: 1,
  absender: 'Florian Nord 1',
  empfaenger: 'ELW 1',
  meldeweg: 'funk',
  inhalt: 'Deich instabil',
  meldungsart: 'sofortmeldung',
  prioritaet: 'normal',
  richtung: 'intern',
  status: 'neu',
  bearbeiter_id: null,
  bearbeiter_name: null,
  lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00',
  eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7,
  auftrag_id: null,
  is_auftrag_aufgehoben: false,
  erfasst_von_id: 1,
  erstellt_at: '2026-06-12 09:05:00',
  ist_offen: true,
  erledigt_at: null,
  bestaetigung_pflicht: false,
  bestaetigung_frist_at: null,
  eskaliert: false,
  bestaetigt_at: null,
  bestaetigt_von_id: null,
  bestaetigt_von_name: null,
  ist_bestaetigt: false,
  ist_ueberfaellig: false,
  ...over,
});

function renderKarte(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/**
 * Greift das GEÖFFNETE Dropdown-Portal: antd lässt geschlossene Portale im Baum, und ein
 * verlassendes bekommt in jsdom nie `hidden` — daher Filter über `pointerEvents`.
 */
async function oeffneAktionsmenue(lfdNr = 1): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Meldung ${lfdNr}` }));
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
    (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
  );
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Das Aktionsmenü zu Meldung ${lfdNr} ließ sich nicht öffnen`);
  return menue;
}

/** Worst Case: neu, bestätigungspflichtig unbestätigt, nicht lagerelevant, kein Auftrag → alle
    sechs Aktionen stehen zur Verfügung. */
const schlimmstenfalls = () =>
  meldung({
    status: 'neu',
    bestaetigung_pflicht: true,
    ist_bestaetigt: false,
    lagerelevant: false,
    auftrag_id: null,
  });

const alleCallbacks = () => ({
  darfSchreiben: true,
  onStatus: vi.fn(),
  onLagerelevant: vi.fn(),
  onBestaetigen: vi.fn(),
  onAuftragErteilen: vi.fn(),
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

// LLH-1177: Ein aufgehobener Auftrag sperrt die Meldung nicht mehr; die Karte zeigt den Hinweis
// statt des Bezugs und bietet „Auftrag erteilen“ wieder an.
describe('MeldungKarte — aufgehobener Auftrag (LLH-1177)', () => {
  it('zeigt „Auftrag aufgehoben“ statt des Deeplinks', () => {
    renderKarte(
      <MeldungKarte
        meldung={meldung({ auftrag_id: 99, is_auftrag_aufgehoben: true })}
        einsatzId={7}
      />,
    );
    expect(screen.getByText('Auftrag aufgehoben')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Auftrag/ })).toBeNull();
  });

  it('bietet „Auftrag erteilen“ wieder an, solange der verknüpfte Auftrag aufgehoben ist', async () => {
    const cb = { darfSchreiben: true, onAuftragErteilen: vi.fn() };
    const m = meldung({ auftrag_id: 99, is_auftrag_aufgehoben: true });
    renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    expect(cb.onAuftragErteilen).toHaveBeenCalledWith(m);
  });

  it('bietet „Auftrag erteilen“ nicht an, solange der verknüpfte Auftrag gilt', () => {
    const cb = { darfSchreiben: true, onAuftragErteilen: vi.fn() };
    renderKarte(<MeldungKarte meldung={meldung({ auftrag_id: 99 })} einsatzId={7} {...cb} />);
    expect(screen.queryByRole('button', { name: /Auftrag erteilen/ })).toBeNull();
    expect(screen.queryByText('Auftrag aufgehoben')).toBeNull();
  });
});

describe('MeldungKarte — Aktionsbündelung (LFH-372/B5k)', () => {
  it('zeigt im Worst-Case höchstens zwei Aktionen im Kartenkörper, den Rest hinter einem Trigger', async () => {
    const cb = alleCallbacks();
    const { container } = renderKarte(
      <MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />,
    );
    const karte = container.querySelector<HTMLElement>('[data-meldung-id="1"]')!;
    // Im Kartenkörper: die zwei Aktionen PLUS der eine Trigger — mehr nicht.
    const knoepfe = within(karte).getAllByRole('button');
    expect(knoepfe.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Bestätigen',
      'Sichten',
      'Aktionen zu Meldung 1',
    ]);
    // Die übrigen vier sind über GENAU EINEN Trigger erreichbar.
    const menue = await oeffneAktionsmenue();
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([
      'Bearbeitung beginnen',
      'Als erledigt melden',
      'In die Lage übernehmen',
      'Auftrag erteilen',
    ]);
  });

  it('„Bestätigen" ist der Primärknopf, nicht rot — Rot bedient nichts (LFH-962)', () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const knopf = screen.getByRole('button', { name: 'Bestätigen' });
    expect(knopf).toHaveClass('ant-btn-primary');
    expect(knopf).not.toHaveClass('ant-btn-dangerous');
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
    // Kein Popconfirm (umkehrbar): der Klick schaltet unmittelbar.
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'gesichtet');
  });

  it('löst „Bearbeitung beginnen" aus dem Menü aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Bearbeitung beginnen/ }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'in_bearbeitung');
  });

  it('löst „Als erledigt melden" aus dem Menü erst nach der Rückfrage aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Als erledigt melden/ }));
    // Ohne Bestätigung passiert nichts — die Rückfrage ist kein Schmuck.
    expect(cb.onStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    // Der Bestätigungsknopf der Rückfrage nennt die Handlung, nicht „Bestätigen" (LFH-959).
    await userEvent.click(within(dialog).getByRole('button', { name: 'Als erledigt melden' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'erledigt');
  });

  it('löst „In die Lage übernehmen" und „Auftrag erteilen" aus dem Menü aus', async () => {
    const cb = alleCallbacks();
    const m = schlimmstenfalls();
    const { unmount } = renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(
      within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /In die Lage übernehmen/ }),
    );
    expect(cb.onLagerelevant).toHaveBeenCalledWith(1);
    unmount();
    renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(
      within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /Auftrag erteilen/ }),
    );
    expect(cb.onAuftragErteilen).toHaveBeenCalledWith(m);
  });

  // Spec `modul-freigabe` (LFH-1051): ohne Freigabe der Aufträge steht „Auftrag erteilen" gesperrt
  // mit Grund da (M16), wie „Zu Auftrag" im Chat.
  it('sperrt „Auftrag erteilen" im Menü mit Grund, wenn die Aufträge nicht freigegeben sind', async () => {
    const cb = alleCallbacks();
    renderKarte(
      <MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} auftragGesperrt />,
    );
    const menue = await oeffneAktionsmenue();
    expect(within(menue).queryByRole('menuitem', { name: 'Auftrag erteilen' })).toBeNull();
    const punkt = within(menue).getByRole('menuitem', {
      name: 'Auftrag erteilen (Keine Berechtigung)',
    });
    expect(punkt).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(punkt);
    expect(cb.onAuftragErteilen).not.toHaveBeenCalled();
  });

  it('sperrt den sichtbaren Knopf „Auftrag erteilen" mit Grund, wenn nicht gebündelt wird', async () => {
    const cb = { darfSchreiben: true, onAuftragErteilen: vi.fn() };
    renderKarte(<MeldungKarte meldung={meldung()} einsatzId={7} {...cb} auftragGesperrt />);
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).toBeNull();
    const knopf = screen.getByRole('button', { name: 'Auftrag erteilen (Keine Berechtigung)' });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    expect(cb.onAuftragErteilen).not.toHaveBeenCalled();
  });

  it('führt bei „in_bearbeitung" „Als erledigt melden" sichtbar — und dann NICHT mehr im Menü', async () => {
    const cb = alleCallbacks();
    renderKarte(
      <MeldungKarte meldung={meldung({ status: 'in_bearbeitung' })} einsatzId={7} {...cb} />,
    );
    expect(screen.queryByRole('button', { name: 'Erledigt' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Als erledigt melden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Als erledigt melden' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'erledigt');
    const menue = await oeffneAktionsmenue();
    expect(within(menue).queryByRole('menuitem', { name: /erledigt/i })).not.toBeInTheDocument();
  });

  it('nennt bei „gesichtet" die Handlung „Bearbeitung beginnen", nicht das Statuswort (LFH-959)', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={meldung({ status: 'gesichtet' })} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeitung beginnen' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'in_bearbeitung');
    expect(screen.queryByRole('button', { name: 'In Bearbeitung' })).not.toBeInTheDocument();
  });

  it('trägt die Uhr im Chip „Bestätigung überfällig", kein eigenes „Alarm" (LFH-959)', () => {
    const cb = alleCallbacks();
    const { container } = renderKarte(
      <MeldungKarte
        meldung={meldung({ bestaetigung_pflicht: true, ist_ueberfaellig: true })}
        einsatzId={7}
        {...cb}
      />,
    );
    const chip = within(container)
      .getByText('Bestätigung überfällig')
      .closest('[data-lfh="status-chip"]')!;
    expect(chip).toHaveAttribute('data-ton', 'alarm');
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(within(container).queryByText(/^\s*Alarm\s*$/)).not.toBeInTheDocument();
  });

  /**
   * Gegenprobe zur Bündelung (gezählt NACH der Rechteprüfung): eine erledigte Meldung ohne
   * Bestätigungspflicht hat nur zwei Aktionen und darf nicht gebündelt werden.
   */
  it('bündelt NICHT, wenn nach der Filterung nur zwei Aktionen übrig sind', async () => {
    const cb = alleCallbacks();
    renderKarte(
      <MeldungKarte
        meldung={meldung({
          status: 'erledigt',
          bestaetigung_pflicht: false,
          lagerelevant: false,
          auftrag_id: null,
        })}
        einsatzId={7}
        {...cb}
      />,
    );
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'In die Lage übernehmen' }));
    expect(cb.onLagerelevant).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'Auftrag erteilen' })).toBeInTheDocument();
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

/**
 * Eingangszustand: „neu" und „gesichtet" liegen beide auf Phase `offen` und müssen trotzdem
 * beim Querscannen unterscheidbar sein.
 */
describe('MeldungKarte · Eingangszustand', () => {
  it('gibt der neuen Meldung einen eigenen Akzent, der gesichteten keinen', () => {
    const { container, rerender } = renderKarte(
      <MeldungKarte meldung={meldung({ status: 'neu' })} einsatzId={7} />,
    );
    expect(container.querySelector('[data-lfh="komm-karte"]')).toHaveAttribute(
      'data-unbearbeitet',
      'true',
    );
    expect(screen.getByText('Neu').closest('[data-lfh="status-chip"]')).toHaveAttribute(
      'data-ton',
      'achtung',
    );

    rerender(
      <MemoryRouter>
        <MeldungKarte meldung={meldung({ status: 'gesichtet' })} einsatzId={7} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-lfh="komm-karte"]')).not.toHaveAttribute(
      'data-unbearbeitet',
    );
    expect(screen.getByText('Gesichtet').closest('[data-lfh="status-chip"]')).not.toHaveAttribute(
      'data-ton',
      'achtung',
    );
  });

  it('lässt den Alarm den Neu-Akzent schlagen', () => {
    // Eine unbestätigte überfällige Sofortmeldung ist BEIDES; der Rand trägt eine Farbe, Gefahr gewinnt.
    const { container } = renderKarte(
      <MeldungKarte
        meldung={meldung({
          status: 'neu',
          bestaetigung_pflicht: true,
          ist_bestaetigt: false,
          ist_ueberfaellig: true,
        })}
        einsatzId={7}
      />,
    );
    const karte = container.querySelector('[data-lfh="komm-karte"]')!;
    expect(karte).toHaveAttribute('data-alarm', 'true');
    expect(karte).not.toHaveAttribute('data-unbearbeitet');
    // Das ETIKETT bleibt trotzdem das der neuen Meldung — nur der Rand ist vergeben.
    expect(screen.getByText('Neu').closest('[data-lfh="status-chip"]')).toHaveAttribute(
      'data-ton',
      'achtung',
    );
  });

  it('macht den Wortlaut zum größten Text der Karte (M69)', () => {
    renderKarte(
      <MeldungKarte
        meldung={meldung({ inhalt: 'Wasser im Keller', absender: 'Florian 1' })}
        einsatzId={7}
      />,
    );
    const inhalt = screen.getByText('Wasser im Keller');
    const absender = screen.getByText('Florian 1');
    // Der Wortlaut ist der größte Text der Karte, nicht der Absender.
    expect(parseFloat(inhalt.style.fontSize)).toBeGreaterThanOrEqual(15);
    expect(inhalt.style.lineHeight).toBe('1.5');
    expect(parseFloat(absender.style.fontSize)).toBeLessThan(parseFloat(inhalt.style.fontSize));
  });
});

/** LFH-692 (Spec `zeiteingabe`): Ereigniszeit, Frist und Quittung wie im Formular. */
describe('MeldungKarte — Zeiten in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  const berlin = { zeitzone: 'Europe/Berlin' };

  it('Ereigniszeit und Bestätigungsfrist stehen als Berliner Zeit da', () => {
    render(
      <AnzeigeKonventionenProvider konventionen={berlin}>
        <MemoryRouter>
          <MeldungKarte
            einsatzId={7}
            meldung={meldung({
              bestaetigung_pflicht: true,
              bestaetigung_frist_at: '2026-06-12 09:30:00',
            })}
          />
        </MemoryRouter>
      </AnzeigeKonventionenProvider>,
    );
    expect(formatZeit('2026-06-12 09:00:00', berlin)).not.toBe(
      formatZeit('2026-06-12 09:00:00', DEFAULT_KONVENTIONEN),
    );
    expect(
      screen.getByText(formatZeit('2026-06-12 09:00:00', berlin), { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Bestätigung offen bis ${formatZeit('2026-06-12 09:30:00', berlin)}`),
    ).toBeInTheDocument();
  });

  it('die Quittierzeit steht als Berliner Zeit da', () => {
    render(
      <AnzeigeKonventionenProvider konventionen={berlin}>
        <MemoryRouter>
          <MeldungKarte
            einsatzId={7}
            meldung={meldung({
              bestaetigung_pflicht: true,
              ist_bestaetigt: true,
              bestaetigt_at: '2026-06-12 09:10:00',
              bestaetigt_von_name: 'Anna',
            })}
          />
        </MemoryRouter>
      </AnzeigeKonventionenProvider>,
    );
    expect(
      screen.getByText(formatZeit('2026-06-12 09:10:00', berlin), { exact: false }),
    ).toBeInTheDocument();
  });
});

/** LFH-974 (Spec `meldungen-handy`): Wortlaut direkt nach Absender/Empfänger, Verwaltung danach. */
describe('MeldungKarte — Wortlaut vor Verwaltung (LFH-974)', () => {
  const mitBearbeiter = () =>
    meldung({ inhalt: 'Deich instabil', bearbeiter_id: 4, bearbeiter_name: 'Anna Berg' });

  function nachher(a: Node, b: Node) {
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  it('steht mit Schreibrecht vor der Bearbeiter-Auswahl, ohne Eingabefeld davor', () => {
    renderKarte(
      <MeldungKarte
        meldung={mitBearbeiter()}
        einsatzId={7}
        darfSchreiben
        onZuweisen={vi.fn()}
        mitglieder={[{ benutzer_id: 4, anzeigename: 'Anna Berg' }]}
      />,
    );
    const wortlaut = screen.getByText('Deich instabil');
    const auswahl = screen.getByRole('combobox', { name: 'Bearbeiter für Meldung 1' });
    expect(nachher(wortlaut, auswahl)).toBe(true);
    const karte = document.querySelector('[data-meldung-id="1"]') as HTMLElement;
    const felder = [...karte.querySelectorAll('input, select, textarea')];
    expect(felder.every((f) => nachher(wortlaut, f))).toBe(true);
  });

  it('nennt den Bearbeiter als Text, auch mit Schreibrecht', () => {
    renderKarte(
      <MeldungKarte
        meldung={mitBearbeiter()}
        einsatzId={7}
        darfSchreiben
        onZuweisen={vi.fn()}
        mitglieder={[{ benutzer_id: 4, anzeigename: 'Anna Berg' }]}
      />,
    );
    expect(screen.getByText('Bearbeiter: Anna Berg')).toBeInTheDocument();
  });

  it('nennt den Bearbeiter ohne Schreibrecht als Text und zeigt keine Auswahl', () => {
    renderKarte(<MeldungKarte meldung={mitBearbeiter()} einsatzId={7} />);
    expect(screen.getByText('Bearbeiter: Anna Berg')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

// LLH-1066: Korrektur an der Karte und „Aus der Lage nehmen“.
describe('MeldungKarte — nachträglich korrigieren (LLH-1066)', () => {
  const korrigierbar = (over: Partial<Meldung> = {}) =>
    meldung({ meldungsart: 'sonstige', status: 'erledigt', ...over });

  it('bietet „Bearbeiten“ an und sendet nur die geänderten Felder', async () => {
    const onKorrigieren = vi.fn().mockResolvedValue(undefined);
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar()}
        einsatzId={7}
        darfSchreiben
        onKorrigieren={onKorrigieren}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const formular = screen.getByRole('form', { name: 'Meldung #1 korrigieren' });
    // Der Eingang bleibt: kein Feld für Wortlaut, Absender, Meldeweg oder Ereigniszeit.
    expect(within(formular).queryByRole('textbox', { name: /Wortlaut|Absender/ })).toBeNull();
    await waehle('Priorität', 'Dringend');
    await userEvent.clear(within(formular).getByRole('textbox', { name: 'Empfänger / Adressat' }));
    await userEvent.click(within(formular).getByRole('button', { name: 'Speichern' }));
    expect(onKorrigieren).toHaveBeenCalledWith(1, { prioritaet: 'dringend', empfaenger: null });
    // Gespeichert: die Bearbeitung schließt, die Aktionszeile kommt zurück.
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Meldung #1 korrigieren' })).toBeNull();
  });

  it('bleibt bei einer Ablehnung offen', async () => {
    const onKorrigieren = vi.fn().mockRejectedValue(new Error('422'));
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar()}
        einsatzId={7}
        darfSchreiben
        onKorrigieren={onKorrigieren}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await waehle('Richtung', 'Extern');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onKorrigieren).toHaveBeenCalledWith(1, { richtung: 'extern' });
    expect(screen.getByRole('form', { name: 'Meldung #1 korrigieren' })).toBeInTheDocument();
  });

  it('schließt ohne Änderung, ohne zu senden; Escape bricht ab', async () => {
    const onKorrigieren = vi.fn();
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar()}
        einsatzId={7}
        darfSchreiben
        onKorrigieren={onKorrigieren}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.queryByRole('form')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Empfänger / Adressat' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('form')).toBeNull();
    expect(onKorrigieren).not.toHaveBeenCalled();
  });

  it('bietet „Sofort“ nur einer Meldung an, die schon sofort ist', async () => {
    renderKarte(
      <MeldungKarte meldung={korrigierbar()} einsatzId={7} darfSchreiben onKorrigieren={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await oeffne('Priorität');
    expect(optionenVon('Priorität')).toEqual(['Dringend', 'Normal']);
    await oeffne('Meldungsart');
    expect(optionenVon('Meldungsart')).not.toContain('Sofortmeldung');
  });

  it('nimmt eine übernommene Meldung erst nach der Rückfrage aus der Lage', async () => {
    const onAusDerLage = vi.fn();
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar({ lagerelevant: true })}
        einsatzId={7}
        darfSchreiben
        onAusDerLage={onAusDerLage}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aus der Lage nehmen' }));
    expect(onAusDerLage).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Lage-Text und Verortung gehen verloren');
    const knopf = within(dialog).getByRole('button', { name: 'Aus der Lage nehmen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    await userEvent.click(knopf);
    expect(onAusDerLage).toHaveBeenCalledWith(1);
  });

  it('bietet „Aus der Lage nehmen“ einer Lagemeldung nicht an', () => {
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar({ lagerelevant: true, meldungsart: 'lagemeldung' })}
        einsatzId={7}
        darfSchreiben
        onAusDerLage={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Aus der Lage nehmen' })).toBeNull();
  });

  it('bietet ohne Schreibrecht weder „Bearbeiten“ noch „Aus der Lage nehmen“ an', () => {
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar({ lagerelevant: true })}
        einsatzId={7}
        onKorrigieren={vi.fn()}
        onAusDerLage={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aus der Lage nehmen' })).toBeNull();
  });
});

describe('MeldungKarte — Empfängerfunktion korrigieren (LLH-1381)', () => {
  const korrigierbar = (over: Partial<Meldung> = {}) =>
    meldung({ meldungsart: 'sonstige', status: 'erledigt', ...over });
  const FUNKTIONEN = [
    { value: 'el' as const, label: 'Einsatzleitung' },
    { value: 's2' as const, label: 'S2 – Lage' },
    { value: 's3' as const, label: 'S3 – Einsatz' },
  ];

  it('bietet die Empfängerfunktion an und sendet nur sie', async () => {
    const onKorrigieren = vi.fn().mockResolvedValue(undefined);
    renderKarte(
      <MeldungKarte
        meldung={korrigierbar({ empfaenger_funktion: 's3' })}
        einsatzId={7}
        darfSchreiben
        onKorrigieren={onKorrigieren}
        funktionsOptionen={FUNKTIONEN}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await oeffne('Empfängerfunktion');
    expect(optionenVon('Empfängerfunktion')).toEqual([
      'Einsatzleitung',
      'S2 – Lage',
      'S3 – Einsatz',
    ]);
    await waehle('Empfängerfunktion', 'S2 – Lage');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onKorrigieren).toHaveBeenCalledWith(1, { empfaenger_funktion: 's2' });
  });

  it('lässt das Feld ohne Katalog weg', async () => {
    renderKarte(
      <MeldungKarte meldung={korrigierbar()} einsatzId={7} darfSchreiben onKorrigieren={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.queryByRole('combobox', { name: 'Empfängerfunktion' })).toBeNull();
  });
});
