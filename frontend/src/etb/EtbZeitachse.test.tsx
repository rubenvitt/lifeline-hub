import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzFixture } from '../test/fixtures';
import { einsatzKeys } from '../api/queryKeys';
import { setzeViewportBreite } from '../test/viewport';
import { baueZeilen, type EtbZeile } from './etbZeile';
import EtbZeitachse, { gezeigteRaender } from './EtbZeitachse';

type ZeitachsenProps = ComponentProps<typeof EtbZeitachse>;

function renderZeitachse(
  props: Omit<Partial<ZeitachsenProps>, 'zeilen'> & {
    eintraege?: EtbEintragAnzeige[];
    zeilen?: readonly EtbZeile[];
  },
) {
  const { eintraege, zeilen, ...rest } = props;
  const bau = (z?: readonly EtbZeile[]) => (
    <EtbZeitachse
      einsatzId={1}
      zeilen={z ?? baueZeilen({ eintraege: eintraege ?? [], ausstehend: [], abgelehnt: [] })}
      {...rest}
    />
  );
  const ergebnis = renderMitProviders(bau(zeilen));
  return { ...ergebnis, neu: (z: readonly EtbZeile[]) => ergebnis.rerender(bau(z)) };
}

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'Lage erkundet',
    von: 'ELW',
    an: 'Leitstelle',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    berichtigt_durch: [],
    anhaenge: [],
    ...over,
  };
}

function ausstehend(over: Partial<AusstehenderEintrag> = {}): AusstehenderEintrag {
  return {
    id: 1,
    benutzer_id: 1,
    einsatz_id: 1,
    eintrag: { typ: 'meldung', inhalt: 'Noch nicht gesendet' },
    erstellt_at: '2026-05-23 10:05:00',
    ...over,
  };
}

function abgelehnt(over: Partial<AbgelehnterEintrag> = {}): AbgelehnterEintrag {
  return {
    ...ausstehend(),
    grund: 'Einsatz abgeschlossen',
    abgelehnt_at: '2026-05-23 10:06:00',
    ...over,
  };
}

function zeileVon(container: HTMLElement, schluessel: string): HTMLElement {
  const z = container.querySelector<HTMLElement>(`[data-zeile="${schluessel}"]`);
  if (!z) throw new Error(`Zeile ${schluessel} fehlt`);
  return z;
}

describe('EtbZeitachse – der Eintrag', () => {
  it('zeigt Zeit, Nr., Typwort, Von→An, Text, Verfasser und Meldeweg', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    const z = zeileVon(container, 'eintrag-1');
    expect(within(z).getByText('Nr. 1')).toBeInTheDocument();
    expect(z.querySelector('[data-lfh="typwort"]')).toHaveTextContent('Meldung');
    expect(within(z).getByText('ELW → Leitstelle')).toBeInTheDocument();
    expect(within(z).getByText('Lage erkundet')).toBeInTheDocument();
    expect(within(z).getByText('Max')).toBeInTheDocument();
    expect(within(z).getByText('Funk')).toBeInTheDocument();
    // Uhrzeit als HH:MM (Anzeigezone), nicht als Wire-String.
    expect(within(z).getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('setzt den Funktions-Snapshot hinter den Verfasser (LFH-615)', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ erfasser_funktion: 'S2' }), eintrag({ id: 2, lfd_nr: 2 })],
    });
    expect(within(zeileVon(container, 'eintrag-1')).getByText('Max · S2')).toBeInTheDocument();
    // Ohne Snapshot nur der Name — keine erfundene Funktion.
    expect(within(zeileVon(container, 'eintrag-2')).getByText('Max')).toBeInTheDocument();
  });

  it('ist auf JEDER Breite eine Zeitachse — keine Tabelle, auch nicht im Fükw', () => {
    for (const breite of [390, 1024, 1366, 1920]) {
      setzeViewportBreite(breite);
      const { container, unmount } = renderZeitachse({ eintraege: [eintrag()] });
      expect(container.querySelector('table'), `${breite}`).toBeNull();
      expect(container.querySelector('[data-lfh-eintrag="zeitachse"]'), `${breite}`).not.toBeNull();
      unmount();
    }
  });

  it('gruppiert nach Stunde mit Tag im Kopf, älteste oben (Funkprotokoll, LLH-1149)', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ id: 3, lfd_nr: 3, ereigniszeit: '2026-05-23 11:10:00', inhalt: 'drei' }),
        eintrag({ id: 2, lfd_nr: 2, ereigniszeit: '2026-05-23 10:40:00', inhalt: 'zwei' }),
        eintrag({ id: 1, lfd_nr: 1, ereigniszeit: '2026-05-23 10:05:00', inhalt: 'eins' }),
      ],
    });
    const gruppen = container.querySelectorAll('[role="group"]');
    expect(gruppen).toHaveLength(2);
    // Der Name kommt aus dem Kopf (`aria-labelledby`), nicht aus einem eigenen `aria-label` —
    // sonst sagte der Vorleser die Stunde doppelt an (LFH-621).
    expect(gruppen[0]).toHaveAccessibleName(/^23\.05\. · \d{2} Uhr$/);
    expect(gruppen[0]).not.toHaveAttribute('aria-label');
    const texte = [...container.querySelectorAll('[data-zeile]')].map((z) => z.textContent);
    expect(texte[0]).toContain('eins');
    expect(texte[2]).toContain('drei');
    // Die Stundengruppen laufen ebenfalls aufsteigend.
    expect(
      within(gruppen[0] as HTMLElement).getByText('eins', { exact: false }),
    ).toBeInTheDocument();
  });

  it('beschriftet einen Nachtrag mit „nachgetragen um HH:MM" — das ⧖ ist Zierde', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ ereigniszeit: '2026-05-23 09:00:00', received_at: '2026-05-23 10:00:00' }),
      ],
    });
    const z = zeileVon(container, 'eintrag-1');
    expect(z).toHaveTextContent(/nachgetragen um \d{2}:\d{2}/);
    // Das Zeichen steht, aber für Vorleser verborgen: die Aussage trägt das Wort.
    const glyphe = within(z).getByText('⧖', { exact: false });
    expect(glyphe.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('beschriftet nichts bei normaler Latenz', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    expect(zeileVon(container, 'eintrag-1')).not.toHaveTextContent('nachgetragen');
  });

  it('verknüpft Berichtigung und Grundeintrag in BEIDE Richtungen, als ↗-Verweise', () => {
    const original = eintrag({ id: 1, lfd_nr: 1, inhalt: 'Falsche Lage' });
    const korrektur = eintrag({
      id: 2,
      lfd_nr: 2,
      typ: 'berichtigung',
      inhalt: 'Korrektur',
      berichtigt_eintrag_id: 1,
    });
    const { container } = renderZeitachse({ eintraege: [korrektur, original] });
    const b = zeileVon(container, 'eintrag-2');
    expect(b).toHaveTextContent('berichtigt Nr. 1');
    expect(within(b).getByRole('link', { name: 'Grundeintrag anzeigen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=1',
    );
    // Die Berichtigung ist getönt und trägt das rote Typwort — das Signal liegt an der
    // Zeile, der Verweis selbst bleibt Bedienfarbe (Rot bedient nichts).
    expect(b).toHaveAttribute('data-toenung', 'berichtigung');
    expect(b.querySelector('[data-lfh="typwort"]')).toHaveTextContent('Berichtigung');

    // Der Grundeintrag liest „berichtigt durch“ aus dem Wire (LLH-1099), nicht aus dem Fenster.
    const o = zeileVon(
      renderZeitachse({
        eintraege: [korrektur, { ...original, berichtigt_durch: [{ id: 2, lfd_nr: 2 }] }],
      }).container,
      'eintrag-1',
    );
    expect(within(o).getByRole('link', { name: '→ Nr. 2' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=2',
    );
  });

  /*
   * LLH-1099: ein berichtigter Eintrag ist IMMER als „berichtigt“ gekennzeichnet — auch unter
   * Typfilter oder außerhalb des Fensters, wo seine Berichtigung nicht geladen ist.
   */
  it('kennzeichnet einen berichtigten Eintrag, auch wenn die Berichtigung nicht geladen ist', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({
          id: 1,
          lfd_nr: 134,
          inhalt: 'Pumpe Lindenstraße 4',
          berichtigt_durch: [{ id: 9, lfd_nr: 135 }],
        }),
      ],
    });
    const z = zeileVon(container, 'eintrag-1');
    expect(within(z).getByText('berichtigt')).toBeInTheDocument();
    expect(within(z).getByRole('link', { name: '→ Nr. 135' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=9',
    );
    // Der Text bleibt vollständig lesbar — der Eintrag ist ein Beleg.
    expect(z).toHaveTextContent('Pumpe Lindenstraße 4');
  });

  it('nennt bei mehreren Berichtigungen die jüngste zuerst, die übrigen in der Hinweiszeile', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({
          id: 1,
          lfd_nr: 100,
          berichtigt_durch: [
            { id: 5, lfd_nr: 120 },
            { id: 8, lfd_nr: 140 },
          ],
        }),
      ],
    });
    const z = zeileVon(container, 'eintrag-1');
    expect(within(z).getByRole('link', { name: '→ Nr. 140' })).toBeInTheDocument();
    expect(within(z).getByRole('link', { name: 'auch berichtigt durch Nr. 120' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=5',
    );
  });

  it('erfindet keine Nummer, wenn der Grundeintrag nicht geladen ist', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ id: 2, lfd_nr: 2, typ: 'berichtigung', berichtigt_eintrag_id: 77 })],
    });
    const b = zeileVon(container, 'eintrag-2');
    expect(b).toHaveTextContent('berichtigt einen älteren Eintrag');
    expect(within(b).getByRole('link', { name: 'Grundeintrag anzeigen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=77',
    );
  });

  it('verweist auf den gekoppelten Befehl als ↗-Link (LFH-25)', () => {
    renderZeitachse({ eintraege: [eintrag({ id: 5, befehl_id: 42 })] });
    expect(screen.getByRole('link', { name: 'Befehl' })).toHaveAttribute(
      'href',
      '/einsaetze/1/auftraege/befehle/42',
    );
  });

  // LFH-636: eine Entscheidung ohne jeden Rückverweis trägt trotzdem ihre Folgeaufträge —
  // die Zeitachse darf die Verweiszeile nicht an den Rückverweisen allein festmachen.
  it('verweist auf Folgeaufträge auch ohne Rückverweis (LFH-636)', () => {
    renderZeitachse({
      eintraege: [
        eintrag({
          id: 5,
          typ: 'entscheidung',
          folgeauftraege: [
            { id: 31, lfd_nr: 12 },
            { id: 32, lfd_nr: 13 },
          ],
        }),
      ],
    });
    expect(screen.getByRole('link', { name: 'Folgeauftrag Nr. 12' })).toHaveAttribute(
      'href',
      '/einsaetze/1/auftraege?auftrag=31',
    );
    expect(screen.getByRole('link', { name: 'Folgeauftrag Nr. 13' })).toHaveAttribute(
      'href',
      '/einsaetze/1/auftraege?auftrag=32',
    );
  });

  // Der Gruppenkopf ist eine echte Überschrift (h2), und die Überschriften IM Eintrag hängen
  // darunter — `#` wird h3, `###` h5 (LFH-621).
  it('gliedert Einträge unter dem Gruppenkopf (h2) — `#` im Eintrag wird h3', () => {
    renderZeitachse({
      eintraege: [
        eintrag({
          ereigniszeit: '2026-05-23 10:05:00',
          inhalt: '# Lage\n\n### Detail',
        }),
      ],
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^23\.05\. · \d{2} Uhr$/);
    expect(screen.getByRole('heading', { level: 3, name: 'Lage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: 'Detail' })).toBeInTheDocument();
  });

  it('rendert Markdown-Inhalt (kein Rohtext mit **)', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ inhalt: '**Lage** erkundet' })],
    });
    expect(container.querySelector('strong')).toBeInTheDocument();
    expect(screen.queryByText('**Lage** erkundet')).not.toBeInTheDocument();
  });

  it('trägt Kartenmarke und Hervorhebung, an denen der Deeplink springt (LFH-25)', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag({ id: 9 })], highlightId: 9 });
    const z = zeileVon(container, 'eintrag-9');
    expect(z).toHaveAttribute('data-lfh', 'datensicht-karte');
    expect(z).toHaveClass('zeile-hervorgehoben');
    // Genau diese Kombination fragt `scrolleZurZeile` ab.
    expect(
      container.querySelectorAll('[data-lfh="datensicht-karte"].zeile-hervorgehoben'),
    ).toHaveLength(1);
  });
});

describe('EtbZeitachse – Aktionsmenü (LFH-365 · B5e)', () => {
  async function oeffneMenue(nr: number): Promise<HTMLElement> {
    await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Eintrag ${nr}` }));
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    if (!menue) throw new Error('Menü nicht offen');
    return menue;
  }

  const alle = {
    onBerichtigen: vi.fn(),
    onWiedervorlage: vi.fn(),
    onAuftragErteilen: vi.fn(),
  };

  it('bündelt drei Aktionen hinter einem Auslöser mit der laufenden Nummer im Namen', async () => {
    const onBerichtigen = vi.fn();
    renderZeitachse({
      eintraege: [eintrag({ id: 4, lfd_nr: 17 })],
      ...alle,
      onBerichtigen,
    });
    // Kein Knopf „Berichtigen" in der Zeile — der Weg läuft über das Aktionsmenü.
    expect(screen.queryByRole('button', { name: 'Berichtigen' })).toBeNull();
    const menue = await oeffneMenue(17);
    const eintraege = within(menue)
      .getAllByRole('menuitem')
      .map((m) => m.textContent);
    expect(eintraege).toEqual(['Berichtigen', 'Wiedervorlage', 'Auftrag erteilen']);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Berichtigen' }));
    expect(onBerichtigen).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('LFH-117: sperrt „Berichtigen" mit sichtbarem Grund, solange ein Entwurf sendet', async () => {
    const onBerichtigen = vi.fn();
    renderZeitachse({
      eintraege: [eintrag({ id: 4, lfd_nr: 17 })],
      ...alle,
      onBerichtigen,
      berichtigenGesperrt: 'erst nach dem Senden',
    });
    const menue = await oeffneMenue(17);
    const punkt = within(menue).getByRole('menuitem', { name: /Berichtigen/ });
    expect(punkt).toHaveTextContent('Berichtigen (erst nach dem Senden)');
    expect(punkt).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(punkt);
    expect(onBerichtigen).not.toHaveBeenCalled();
  });

  // Spec `modul-freigabe` (LFH-1051): ohne Freigabe der Aufträge steht „Auftrag erteilen" gesperrt
  // mit Grund da (M16), wie „Zu Auftrag" im Chat, statt in ein 403 zu laufen.
  it('sperrt „Auftrag erteilen" mit Grund, wenn die Aufträge nicht freigegeben sind', async () => {
    const onAuftragErteilen = vi.fn();
    renderZeitachse({
      eintraege: [eintrag({ id: 4, lfd_nr: 17 })],
      ...alle,
      onAuftragErteilen,
      auftragGesperrt: true,
    });
    const menue = await oeffneMenue(17);
    expect(within(menue).queryByRole('menuitem', { name: 'Auftrag erteilen' })).toBeNull();
    const punkt = within(menue).getByRole('menuitem', {
      name: 'Auftrag erteilen (Keine Berechtigung)',
    });
    expect(punkt).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(punkt);
    expect(onAuftragErteilen).not.toHaveBeenCalled();
    expect(within(menue).getByRole('menuitem', { name: 'Wiedervorlage' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('lässt „Auftrag erteilen" bedienbar, wenn die Aufträge freigegeben sind', async () => {
    const onAuftragErteilen = vi.fn();
    renderZeitachse({
      eintraege: [eintrag({ id: 4, lfd_nr: 17 })],
      ...alle,
      onAuftragErteilen,
      auftragGesperrt: false,
    });
    const menue = await oeffneMenue(17);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Auftrag erteilen' }));
    expect(onAuftragErteilen).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('bietet „Berichtigen" auch an einer Berichtigung an (LLH-1099)', async () => {
    const onBerichtigen = vi.fn();
    renderZeitachse({
      eintraege: [eintrag({ id: 2, lfd_nr: 2, typ: 'berichtigung', berichtigt_eintrag_id: 1 })],
      ...alle,
      onBerichtigen,
    });
    const menue = await oeffneMenue(2);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Berichtigen' }));
    expect(onBerichtigen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('rendert keinen Auslöser, wenn keine Aktion übrig bleibt (Lesende)', () => {
    renderZeitachse({ eintraege: [eintrag()] });
    expect(screen.queryByRole('button', { name: /Aktionen zu Eintrag/ })).toBeNull();
  });
});

describe('EtbZeitachse – gepufferte Einträge', () => {
  it('zeigt einen ausstehenden Eintrag als eigene Zeile, ohne Nummer und ohne Aktionen', () => {
    const { container } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [eintrag()], ausstehend: [ausstehend()], abgelehnt: [] }),
      onBerichtigen: vi.fn(),
    });
    const z = zeileVon(container, 'ausstehend-1');
    expect(z).toHaveTextContent('Noch nicht gesendet');
    expect(z).toHaveTextContent('vorgemerkt');
    expect(z).not.toHaveTextContent('Nr.');
    expect(within(z).queryByRole('button')).toBeNull();
    // Und sie steht NACH den gesendeten, ganz unten über der Erfassung — sie ist der jüngste
    // Eintrag (Funkprotokoll, LLH-1149).
    const reihenfolge = [...container.querySelectorAll('[data-zeile]')].map((e) =>
      e.getAttribute('data-zeile'),
    );
    expect(reihenfolge).toEqual(['eintrag-1', 'ausstehend-1']);
  });

  it('bietet an einer abgelehnten Zeile beide Auswege offen an und nennt den Grund', async () => {
    const onErneutSenden = vi.fn();
    const onVerwerfen = vi.fn();
    const { container } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [], ausstehend: [], abgelehnt: [abgelehnt()] }),
      onErneutSenden,
      onVerwerfen,
    });
    const z = zeileVon(container, 'abgelehnt-1');
    expect(z).toHaveTextContent('Vom Server abgelehnt: Einsatz abgeschlossen');
    expect(z).toHaveAttribute('data-toenung', 'problem');
    await userEvent.click(within(z).getByRole('button', { name: 'Erneut senden' }));
    await userEvent.click(within(z).getByRole('button', { name: 'Verwerfen' }));
    expect(onErneutSenden).toHaveBeenCalledTimes(1);
    expect(onVerwerfen).toHaveBeenCalledTimes(1);
    // Ohne Kopplung an den Meldungseingang gibt es keinen dritten Weg (LLH-1037).
    expect(within(z).queryByRole('button', { name: 'Nur protokollieren' })).toBeNull();
  });

  it('bietet an einer abgelehnten Zeile für den Meldungseingang „Nur protokollieren“ an (LLH-1037)', async () => {
    const onNurProtokollieren = vi.fn();
    const zeile = abgelehnt({ grund: 'Modul Meldungen gesperrt' });
    zeile.eintrag = { ...zeile.eintrag, typ: 'lage', in_meldungseingang: true };
    const { container } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [], ausstehend: [], abgelehnt: [zeile] }),
      onErneutSenden: vi.fn(),
      onVerwerfen: vi.fn(),
      onNurProtokollieren,
    });
    const z = zeileVon(container, 'abgelehnt-1');
    await userEvent.click(within(z).getByRole('button', { name: 'Nur protokollieren' }));
    expect(onNurProtokollieren).toHaveBeenCalledWith(zeile);
  });
});

describe('EtbZeitachse – Datenzustände (LFH-331 · B3)', () => {
  it('zeigt den Leertext, wenn die Menge leer und der Abruf durch ist', () => {
    renderZeitachse({ leerText: 'Noch keine Einträge.' });
    expect(screen.getByText('Noch keine Einträge.')).toBeInTheDocument();
  });

  it('zeigt beim Laden Skelettbalken und keinen Leertext', () => {
    const { container } = renderZeitachse({ ladend: true, leerText: 'Noch keine Einträge.' });
    expect(container.querySelector('.lfh-skelett')).not.toBeNull();
    expect(screen.queryByText('Noch keine Einträge.')).toBeNull();
  });

  it('unterdrückt den Leertext im Fehlerfall', () => {
    renderZeitachse({ fehler: true, leerText: 'Noch keine Einträge.' });
    expect(screen.queryByText('Noch keine Einträge.')).toBeNull();
  });
});

/**
 * Live-Zufluss springt nicht unter dem Cursor (Bedien-Leitlinie Festlegung 6). Die Achse
 * friert beim Fokuseintritt ein, neuer Zufluss steht im Sammelbanner.
 */
describe('EtbZeitachse – Sammelbanner', () => {
  const alt = eintrag({ id: 1, lfd_nr: 1, inhalt: 'Alt' });
  const neu = eintrag({ id: 2, lfd_nr: 2, inhalt: 'Neu' });
  const zeilenAus = (e: EtbEintragAnzeige[]) =>
    baueZeilen({ eintraege: e, ausstehend: [], abgelehnt: [] });

  it('nimmt einen neuen Eintrag direkt auf, solange der Fokus außerhalb liegt', () => {
    const { neu: setze } = renderZeitachse({ zeilen: zeilenAus([alt]) });
    setze(zeilenAus([neu, alt]));
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hält ihn zurück, solange der Fokus in der Zeitachse liegt, und zeigt ihn auf „anzeigen"', async () => {
    const { neu: setze } = renderZeitachse({
      zeilen: zeilenAus([alt]),
      onWiedervorlage: vi.fn(),
    });
    const ausloeser = screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' });
    act(() => ausloeser.focus());
    setze(zeilenAus([neu, alt]));
    expect(screen.queryByText('Neu')).toBeNull();
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('1 neuer Eintrag');
    await userEvent.click(within(banner).getByRole('button', { name: 'anzeigen' }));
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('taut beim Verlassen auf — aber nicht, wenn der Fokus in ein Menü im Portal geht', () => {
    const { container, neu: setze } = renderZeitachse({
      zeilen: zeilenAus([alt]),
      onWiedervorlage: vi.fn(),
    });
    const wurzel = container.querySelector<HTMLElement>('[data-lfh="etb-zeitachse"]')!;
    const ausloeser = screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' });
    act(() => ausloeser.focus());
    setze(zeilenAus([neu, alt]));
    // Ein Portal-Menü: `relatedTarget` in `.ant-dropdown` außerhalb der Wurzel. Geprüft am
    // Handler selbst — jsdom schiebt den Fokus beim Öffnen nicht.
    const portal = document.createElement('div');
    portal.className = 'ant-dropdown';
    const ziel = document.createElement('button');
    portal.appendChild(ziel);
    document.body.appendChild(portal);
    try {
      fireEvent.focusOut(wurzel, { relatedTarget: ziel });
      expect(screen.queryByText('Neu')).toBeNull();
      fireEvent.focusOut(wurzel, { relatedTarget: document.body });
      expect(screen.getByText('Neu')).toBeInTheDocument();
    } finally {
      portal.remove();
    }
  });

  it('hält gepufferte Einträge NIE zurück — sie sind die eigenen', () => {
    const { neu: setze } = renderZeitachse({
      zeilen: zeilenAus([alt]),
      onWiedervorlage: vi.fn(),
    });
    act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
    setze(baueZeilen({ eintraege: [alt], ausstehend: [ausstehend()], abgelehnt: [] }));
    expect(screen.getByText('Noch nicht gesendet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  /*
   * „Grundeintrag anzeigen" auf einen nicht geladenen Eintrag: der Fokus steht im Verweis, die
   * Seite lädt ÄLTERE Seiten nach. Die kommen unten an und gehören sofort in die Achse, nicht
   * ins Banner.
   */
  it('sortiert nachgeladene ältere Einträge auch eingefroren sofort ein', () => {
    const berichtigung = eintrag({
      id: 20,
      lfd_nr: 20,
      typ: 'berichtigung',
      inhalt: 'Korrektur',
      berichtigt_eintrag_id: 5,
    });
    const grund = eintrag({ id: 5, lfd_nr: 5, inhalt: 'Grundeintrag alt' });
    const { container, neu: setze } = renderZeitachse({ zeilen: zeilenAus([berichtigung]) });
    act(() => screen.getByRole('link', { name: 'Grundeintrag anzeigen' }).focus());
    setze(zeilenAus([berichtigung, grund]));
    expect(screen.getByText('Grundeintrag alt')).toBeInTheDocument();
    expect(zeileVon(container, 'eintrag-5')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  /*
   * Der eigene gepufferte Eintrag geht raus — `ausstehend-<queueId>` verschwindet,
   * `eintrag-<dbId>` kommt mit neuem Schlüssel. Zurückgehalten wäre er nirgends zu sehen.
   */
  it('zeigt den eigenen gerade gesendeten Eintrag sofort, auch eingefroren', () => {
    const { neu: setze } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [alt], ausstehend: [ausstehend()], abgelehnt: [] }),
      onWiedervorlage: vi.fn(),
      eigeneBenutzerId: 42,
    });
    act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
    setze(
      zeilenAus([
        eintrag({ id: 2, lfd_nr: 2, inhalt: 'Noch nicht gesendet', erfasser_id: 42 }),
        alt,
      ]),
    );
    expect(screen.getByText('Noch nicht gesendet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('meldet den NEUEN Eintrag eines anderen Erfassers weiter im Banner', () => {
    const { neu: setze } = renderZeitachse({
      zeilen: zeilenAus([alt]),
      onWiedervorlage: vi.fn(),
      eigeneBenutzerId: 42,
    });
    act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
    setze(zeilenAus([eintrag({ id: 2, lfd_nr: 2, inhalt: 'Fremd', erfasser_id: 7 }), alt]));
    expect(screen.queryByText('Fremd')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('1 neuer Eintrag');
  });

  /*
   * Funkprotokoll (LLH-1149, design.md D2): wer hochgerollt hat, liest — auch ohne Fokus. Neue
   * Einträge kommen unten an; das Banner steht dort, „anzeigen“ rollt ans Ende.
   */
  it('hält hochgerollt zurück, taut am Ende auf und rollt auf „anzeigen“ ans Ende', async () => {
    const onZumEnde = vi.fn();
    const bau = (zeilen: readonly EtbZeile[], amEnde: boolean) => (
      <EtbZeitachse einsatzId={1} zeilen={zeilen} amEnde={amEnde} onZumEnde={onZumEnde} />
    );
    const { rerender } = renderMitProviders(bau(zeilenAus([alt]), true));
    rerender(bau(zeilenAus([alt]), false));
    rerender(bau(zeilenAus([neu, alt]), false));
    expect(screen.queryByText('Neu')).toBeNull();
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('1 neuer Eintrag');
    await userEvent.click(within(banner).getByRole('button', { name: 'anzeigen' }));
    expect(onZumEnde).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    // Zurück am Ende ohne Fokus: Neues steht sofort, kein Banner.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    rerender(bau(zeilenAus([neu, alt]), true));
    rerender(bau(zeilenAus([eintrag({ id: 3, lfd_nr: 3, inhalt: 'Dritt' }), neu, alt]), true));
    expect(screen.getByText('Dritt')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bleibt hochgerollt eingefroren, wenn der Fokus die Zeitachse verlässt', () => {
    const bau = (zeilen: readonly EtbZeile[]) => (
      <EtbZeitachse einsatzId={1} zeilen={zeilen} amEnde={false} onWiedervorlage={vi.fn()} />
    );
    const { container, rerender } = renderMitProviders(bau(zeilenAus([alt])));
    const wurzel = container.querySelector<HTMLElement>('[data-lfh="etb-zeitachse"]')!;
    act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
    rerender(bau(zeilenAus([neu, alt])));
    fireEvent.focusOut(wurzel, { relatedTarget: document.body });
    expect(screen.queryByText('Neu')).toBeNull();
  });

  it('hebt das Einfrieren beim Sprung auf einen Eintrag auf (?eintrag=)', () => {
    const bau = (zeilen: readonly EtbZeile[], sprungMarke?: number) => (
      <EtbZeitachse
        einsatzId={1}
        zeilen={zeilen}
        onWiedervorlage={vi.fn()}
        highlightId={sprungMarke != null ? 2 : null}
        sprungMarke={sprungMarke}
      />
    );
    const { rerender } = renderMitProviders(bau(zeilenAus([alt])));
    act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
    rerender(bau(zeilenAus([neu, alt])));
    expect(screen.queryByText('Neu')).toBeNull();
    rerender(bau(zeilenAus([neu, alt]), 1));
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('EtbZeitachse – gezeigte Ränder für den Bildlauf (LLH-1149)', () => {
  it('meldet einen zurückgehaltenen Eintrag erst, wenn er erscheint', async () => {
    const onGezeigt = vi.fn();
    const alt = eintrag({ id: 1, lfd_nr: 1, erfasser_id: 2 });
    const neu = eintrag({ id: 2, lfd_nr: 2, erfasser_id: 2, ereigniszeit: '2026-05-23 10:05:00' });
    const zeilen = (e: EtbEintragAnzeige[]) =>
      baueZeilen({ eintraege: e, ausstehend: [], abgelehnt: [] });
    const { neu: rerender } = renderZeitachse({
      eintraege: [alt],
      onGezeigt,
      eigeneBenutzerId: 1,
      onWiedervorlage: vi.fn(),
    });
    expect(onGezeigt).toHaveBeenLastCalledWith({ juengste: '|eintrag-1', aelteste: 'eintrag-1' });
    // Fokus in der Achse friert ein: der neue fremde Eintrag wird zurückgehalten.
    act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
    rerender(zeilen([neu, alt]));
    expect(onGezeigt).toHaveBeenLastCalledWith({ juengste: '|eintrag-1', aelteste: 'eintrag-1' });
    await userEvent.click(screen.getByRole('button', { name: 'anzeigen' }));
    expect(onGezeigt).toHaveBeenLastCalledWith({ juengste: '|eintrag-2', aelteste: 'eintrag-1' });
  });

  it('nennt im unteren Rand die Puffer UND den jüngsten Eintrag: eine stehende Ablehnung hält nichts an', () => {
    const mit = (e: EtbEintragAnzeige[]) =>
      gezeigteRaender(baueZeilen({ eintraege: e, ausstehend: [], abgelehnt: [abgelehnt()] }));
    const vorher = mit([eintrag({ id: 1 })]).juengste;
    const nachher = mit([eintrag({ id: 2 }), eintrag({ id: 1 })]).juengste;
    expect(nachher).not.toBe(vorher);
    expect(gezeigteRaender([]).juengste).toBeUndefined();
  });

  it('taut beim Wechsel der Menge auf (Filter)', async () => {
    const alt = eintrag({ id: 1, lfd_nr: 1, erfasser_id: 2 });
    const neu = eintrag({ id: 2, lfd_nr: 2, erfasser_id: 2, ereigniszeit: '2026-05-23 10:05:00' });
    const z = (e: EtbEintragAnzeige[]) =>
      baueZeilen({ eintraege: e, ausstehend: [], abgelehnt: [] });
    const ergebnis = renderMitProviders(
      <EtbZeitachse einsatzId={1} zeilen={z([alt])} amEnde fensterSchluessel="a" />,
    );
    // Hochgerollt: die Achse friert ein.
    ergebnis.rerender(
      <EtbZeitachse einsatzId={1} zeilen={z([alt])} amEnde={false} fensterSchluessel="a" />,
    );
    ergebnis.rerender(
      <EtbZeitachse einsatzId={1} zeilen={z([neu, alt])} amEnde={false} fensterSchluessel="a" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/1 neue/);
    ergebnis.rerender(
      <EtbZeitachse einsatzId={1} zeilen={z([neu, alt])} amEnde={false} fensterSchluessel="b" />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByTestId('etb-ereigniszeile')).toHaveLength(2);
  });
});

describe('EtbZeitachse – Lesemarke als Trennlinie (LLH-1149)', () => {
  it('setzt die Linie direkt unter den zuletzt gesichteten Eintrag', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ id: 3, lfd_nr: 3, ereigniszeit: '2026-05-23 10:30:00' }),
        eintrag({ id: 2, lfd_nr: 2, ereigniszeit: '2026-05-23 10:20:00' }),
        eintrag({ id: 1, lfd_nr: 1, ereigniszeit: '2026-05-23 10:10:00' }),
      ],
      lesemarke: { nachLfdNr: 2, knoten: <li data-testid="linie">Neu seit</li> },
    });
    const folge = [...container.querySelectorAll('[data-zeile], [data-testid="linie"]')].map(
      (el) => el.getAttribute('data-zeile') ?? 'linie',
    );
    expect(folge).toEqual(['eintrag-1', 'eintrag-2', 'linie', 'eintrag-3']);
  });
});

describe('EtbZeitachse – Systemeinträge (LLH-1106)', () => {
  const sys = (id: number, over: Partial<EtbEintragAnzeige> = {}) =>
    eintrag({
      id,
      lfd_nr: id,
      typ: 'system',
      inhalt: `Status ${id}`,
      von: 'System',
      an: 'System',
      meldeweg: null,
      ereigniszeit: `2026-05-23 10:0${id}:00`,
      received_at: `2026-05-23 10:0${id}:01`,
      ...over,
    });
  // Serverordnung: jüngste zuerst.
  const folge = (n: number) => Array.from({ length: n }, (_, i) => sys(n - i));

  it('steht leise und ohne „System → System“, Verfasser bleibt', () => {
    const { container } = renderZeitachse({ eintraege: [sys(1)] });
    const z = zeileVon(container, 'eintrag-1');
    expect(z).toHaveAttribute('data-leise', 'true');
    expect(z).not.toHaveTextContent('System → System');
    expect(z).toHaveTextContent('Max');
  });

  it('zeigt eine bekannte Seite weiter', () => {
    const { container } = renderZeitachse({ eintraege: [sys(1, { an: 'ELW 1' })] });
    expect(zeileVon(container, 'eintrag-1')).toHaveTextContent('System → ELW 1');
  });

  it('lässt einen Handeintrag laut', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    expect(zeileVon(container, 'eintrag-1')).not.toHaveAttribute('data-leise');
  });

  it('lässt zwei stehen und bündelt drei zu einer Zeile, zu bis zum Aufklappen', async () => {
    const zwei = renderZeitachse({ eintraege: folge(2) });
    expect(screen.queryByTestId('etb-buendelzeile')).toBeNull();
    zwei.unmount();

    renderZeitachse({ eintraege: folge(3) });
    const knopf = screen.getByRole('button', { name: /^3 Systemeinträge .+ anzeigen$/ });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Status 2')).toBeNull();
    await userEvent.click(knopf);
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Status 2')).toBeInTheDocument();
  });

  it('bleibt aufgeklappt, wenn die Folge unten wächst', async () => {
    const { neu } = renderZeitachse({ eintraege: folge(3) });
    await userEvent.click(screen.getByRole('button', { name: /3 Systemeinträge/ }));
    // Fokus raus: sonst hielte die Zeitachse den neuen Eintrag zurück (Sammelbanner).
    act(() => (document.activeElement as HTMLElement).blur());
    neu(baueZeilen({ eintraege: folge(4), ausstehend: [], abgelehnt: [] }));
    const knopf = screen.getByRole('button', { name: /4 Systemeinträge/ });
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Status 4')).toBeInTheDocument();
  });

  it('klappt ein Bündel auf, in das ein Sprung zeigt, und hebt den Eintrag hervor', () => {
    const { container } = renderZeitachse({ eintraege: folge(3), highlightId: 2, sprungMarke: 1 });
    expect(screen.getByRole('button', { name: /3 Systemeinträge/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(zeileVon(container, 'eintrag-2').className).toContain('zeile-hervorgehoben');
  });

  it('bündelt nicht unter einer Volltextsuche und nicht, wenn die Seite es abschaltet', () => {
    const q = renderZeitachse({ eintraege: folge(3), fundstellen: 'Status' });
    expect(screen.queryByTestId('etb-buendelzeile')).toBeNull();
    q.unmount();
    renderZeitachse({ eintraege: folge(3), buendeln: false });
    expect(screen.queryByTestId('etb-buendelzeile')).toBeNull();
  });
});

describe('EtbZeitachse – Anhänge (LFH-117)', () => {
  const foto = {
    id: 9,
    einsatz_id: 1,
    dateiname: 'IMG_0412.HEIC',
    mime: 'image/heic',
    groesse: 3_250_586,
    hochgeladen_von: 1,
    erstellt_at: '2026-05-23 10:00:00',
  };

  it('zeigt die Anhänge in der Hinweiszeile, auch ohne jede Kopplung', () => {
    // Die Anhänge dürfen nicht an `hatVerknuepfung` hängen — der Eintrag hier hat weder Befehl
    // noch Lagebericht noch Auftrag noch Folgeauftrag.
    const { container } = renderZeitachse({ eintraege: [eintrag({ anhaenge: [foto] })] });
    const z = zeileVon(container, 'eintrag-1');
    const verweis = within(z).getByRole('link', {
      name: 'IMG_0412.HEIC, 3,1 MB, Anhang zu Nr. 1 herunterladen',
    });
    expect(verweis).toHaveAttribute('href', '/api/einsaetze/1/etb/1/anhaenge/9');
  });

  it.each([
    ['einsatzleitung', 1],
    ['fuehrungspersonal', 0],
  ] as const)(
    'fragt die Rolle aus dem Einsatz-Cache: %s sieht %i Original-Verweis (LFH-747)',
    (rolle, anzahl) => {
      const client = neuerQueryClient();
      client.setQueryData(einsatzKeys.einsatz(1), einsatzFixture({ id: 1, meine_rolle: rolle }));
      const { container } = renderMitProviders(
        <EtbZeitachse
          einsatzId={1}
          zeilen={baueZeilen({
            eintraege: [eintrag({ anhaenge: [foto] })],
            ausstehend: [],
            abgelehnt: [],
          })}
        />,
        { client },
      );
      const z = zeileVon(container, 'eintrag-1');
      expect(within(z).queryAllByText('Original (mit Standort)')).toHaveLength(anzahl);
    },
  );

  it('lässt einen Eintrag ohne Anhang unverändert', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    const z = zeileVon(container, 'eintrag-1');
    expect(within(z).queryByRole('link')).toBeNull();
    expect(z.querySelector('[data-lfh="etb-anhaenge"]')).toBeNull();
  });

  it('nennt an einer ausstehenden Zeile die Zahl der Anhänge, die mitgehen', () => {
    const { container } = renderZeitachse({
      zeilen: baueZeilen({
        eintraege: [],
        ausstehend: [
          ausstehend({ eintrag: { typ: 'meldung', inhalt: 'Foto', anhang_ids: [4, 5] } }),
          ausstehend({ id: 2, eintrag: { typ: 'meldung', inhalt: 'Eins', anhang_ids: [6] } }),
          ausstehend({ id: 3, eintrag: { typ: 'meldung', inhalt: 'Ohne' } }),
        ],
        abgelehnt: [],
      }),
    });
    expect(zeileVon(container, 'ausstehend-1')).toHaveTextContent('2 Anhänge');
    expect(zeileVon(container, 'ausstehend-2')).toHaveTextContent('1 Anhang');
    expect(zeileVon(container, 'ausstehend-3')).not.toHaveTextContent('Anhang');
  });
});

describe('EtbZeitachse – Dokumente mit ETB-Bezug (LFH-743)', () => {
  const plan = {
    id: 3,
    titel: 'Lageplan Nord',
    dateiname: 'plan.pdf',
    groesse: 2048,
    mime: 'application/pdf',
  };

  it('zeigt am bezogenen Eintrag einen Verweis auf die Dokument-Route', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag(), eintrag({ id: 2, lfd_nr: 2 })],
      dokumente: new Map([[2, [plan]]]),
    });
    const verweis = within(zeileVon(container, 'eintrag-2')).getByRole('link', {
      name: 'Dokument „Lageplan Nord“, 2,0 KB, zu Nr. 2 herunterladen',
    });
    expect(verweis).toHaveAttribute('href', '/api/einsaetze/1/dokumente/3/datei');
    expect(within(zeileVon(container, 'eintrag-1')).queryByRole('link')).toBeNull();
  });

  it('zeigt ohne Zuordnung (kein Modulrecht) keinen Verweis', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    const z = zeileVon(container, 'eintrag-1');
    expect(within(z).queryByRole('link')).toBeNull();
    expect(z.querySelector('[data-lfh="etb-dokumente"]')).toBeNull();
  });
});

/**
 * LFH-1056: Bei gesetztem Volltext markiert die Zeitachse, warum ein Eintrag dasteht — in Inhalt,
 * Von, An und Veranlassung. Die Veranlassung steht sonst nicht in der Zeile; sie erscheint nur,
 * wenn die Suche sie trifft.
 */
describe('EtbZeitachse — Fundstellen der Volltextsuche', () => {
  const marken = (c: HTMLElement) => [...c.querySelectorAll('mark')].map((m) => m.textContent);

  it('markiert Inhalt, Von und An', () => {
    const { container } = renderZeitachse({
      fundstellen: 'Deich Nord',
      eintraege: [
        eintrag({ inhalt: 'Deichbruch bei Hochdeich', von: 'EA Nord', an: 'Leitstelle' }),
      ],
    });
    expect(marken(container)).toEqual(['Nord', 'Deich']);
  });

  it('zeigt eine getroffene Veranlassung mit Markierung', () => {
    renderZeitachse({
      fundstellen: 'brandschutz',
      eintraege: [eintrag({ veranlassung: 'Brandschutz gestellt' })],
    });
    const zeile = screen.getByTestId('etb-ereigniszeile');
    expect(zeile).toHaveTextContent('Veranlassung: Brandschutz gestellt');
    expect(within(zeile).getByText('Brandschutz').tagName).toBe('MARK');
  });

  it('ohne Treffer in der Veranlassung bleibt sie weg', () => {
    renderZeitachse({
      fundstellen: 'lage',
      eintraege: [eintrag({ veranlassung: 'Brandschutz gestellt' })],
    });
    expect(screen.getByTestId('etb-ereigniszeile')).not.toHaveTextContent('Veranlassung');
  });

  it('ohne Suchbegriff keine Markierung', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ inhalt: 'Deichbruch', veranlassung: 'Deich sichern' })],
    });
    expect(container.querySelector('mark')).toBeNull();
    expect(container).not.toHaveTextContent('Veranlassung');
  });

  it('gepufferte Zeilen hat der Server nicht gefunden: keine Markierung', () => {
    const { container } = renderZeitachse({
      fundstellen: 'gesendet',
      zeilen: baueZeilen({ eintraege: [], ausstehend: [ausstehend()], abgelehnt: [] }),
    });
    expect(container).toHaveTextContent('Noch nicht gesendet');
    expect(container.querySelector('mark')).toBeNull();
  });
});

describe('Nach oben', () => {
  function rolle(scrollY: number) {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
  }

  it('steht erst, wenn mehr als eine Fensterhöhe darüber liegt, und rollt an den Anfang', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    try {
      rolle(0);
      renderZeitachse({ eintraege: [eintrag()] });
      expect(screen.queryByRole('button', { name: 'Nach oben' })).toBeNull();

      rolle(window.innerHeight + 1);
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Nach oben' }));
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

      rolle(0);
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(screen.queryByRole('button', { name: 'Nach oben' })).toBeNull();
    } finally {
      rolle(0);
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('steht über dem Sammelbanner, nicht darauf', () => {
    rolle(window.innerHeight + 1);
    try {
      const { neu } = renderZeitachse({ eintraege: [eintrag()], onWiedervorlage: vi.fn() });
      // Fokus in der Achse friert ein: der neue Eintrag steht im Banner.
      act(() => screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }).focus());
      neu(
        baueZeilen({
          eintraege: [eintrag({ id: 2, lfd_nr: 2 }), eintrag()],
          ausstehend: [],
          abgelehnt: [],
        }),
      );
      const knopf = screen.getByRole('button', { name: 'Nach oben' });
      const banner = document.querySelector('[data-lfh="sammelbanner"]')!;
      expect(knopf.parentElement).toBe(banner.parentElement);
      expect(knopf.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      rolle(0);
    }
  });
});
