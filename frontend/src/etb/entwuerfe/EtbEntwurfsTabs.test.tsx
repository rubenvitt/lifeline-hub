// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfSpeichern } from './entwurfStore';
import EtbEntwurfsTabs from './EtbEntwurfsTabs';

const einsatz = {
  id: 7,
  bezeichnung: 'Test',
  stichwort: null,
  leitstellen_nr: null,
  einsatzort: null,
} as unknown as EinsatzAnzeige;

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
  server.use(
    http.get('/api/einsaetze/:id/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/einheiten', () => HttpResponse.json([])),
  );
});

function props(over: Partial<React.ComponentProps<typeof EtbEntwurfsTabs>> = {}) {
  return {
    einsatzId: 7,
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    bausteine: [] as EtbBaustein[],
    einsatz,
    werteBehalten: true,
    onWerteBehaltenChange: vi.fn(),
    ...over,
  };
}

/**
 * Wrapper, der den Schalterzustand hält — seit er in `EtbPage` liegt und nicht mehr
 * in den Tabs (LFH-332, Review). Wer ihn im Test umlegen will, braucht diesen
 * Zustand; die Tabs selbst sind darin jetzt gesteuert.
 */
function MitSchalter(p: React.ComponentProps<typeof EtbEntwurfsTabs>) {
  const [behalten, setBehalten] = useState(p.werteBehalten);
  return <EtbEntwurfsTabs {...p} werteBehalten={behalten} onWerteBehaltenChange={setBehalten} />;
}

describe('EtbEntwurfsTabs', () => {
  it('LFH-461: Folgeentwurf ohne Werte behalten bleibt auch nach Remount ohne An', async () => {
    const p = props({
      einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' },
      werteBehalten: false,
    });
    const ersteAnsicht = renderMitProviders(<EtbEntwurfsTabs {...p} />);
    expect(await screen.findByText('An: Florian Leitung')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Meldung{Enter}');
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    await waitFor(async () => expect((await entwuerfeLaden(7))[0]?.inhalt).toBe(''));
    ersteAnsicht.unmount();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    expect(await screen.findByPlaceholderText(/Inhalt/)).toHaveValue('');
    expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
  });

  it('LFH-461: nur den Standard-Chip entfernen überlebt auch den vollständigen Remount', async () => {
    const p = props({ einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' } });
    const ersteAnsicht = renderMitProviders(<EtbEntwurfsTabs {...p} />);
    expect(await screen.findByText('An: Florian Leitung')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu An' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Entfernen/ }));
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(1));
    ersteAnsicht.unmount();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    expect(await screen.findByPlaceholderText(/Inhalt/)).toHaveValue('');
    expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
  });

  it('LFH-461: echte Tabs belegen nur anfangs vor; Entfernen überlebt Tabwechsel und Kontext-Refetch', async () => {
    const p = props({ einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' } });
    const { rerender } = renderMitProviders(<EtbEntwurfsTabs {...p} />);
    expect(await screen.findByText('An: Florian Leitung')).toBeInTheDocument();
    const ersterTab = screen.getAllByRole('tab')[0];
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu An' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Entfernen/ }));
    await userEvent.click(screen.getByRole('button', { name: /add|hinzu/i }));
    expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
    await userEvent.click(ersterTab);
    rerender(
      <EtbEntwurfsTabs
        {...p}
        einsatz={{ ...p.einsatz, meine_fuehrungsstelle: 'Andere Leitung' }}
      />,
    );
    expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
  });

  it.each([true, false])(
    'LFH-461: nach Absenden entscheidet Werte behalten (%s)',
    async (behalten) => {
      const p = props({
        einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' },
        werteBehalten: behalten,
      });
      renderMitProviders(<EtbEntwurfsTabs {...p} />);
      expect(await screen.findByText('An: Florian Leitung')).toBeInTheDocument();
      await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Erste Meldung{Enter}');
      await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
      if (behalten) expect(screen.getByText('An: Florian Leitung')).toBeInTheDocument();
      else expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
    },
  );

  it('LFH-461: Wertübernahme befüllt keinen bereits vorhandenen Entwurf mit bewusst leerem An', async () => {
    const basis = {
      einsatz_id: 7,
      typ: 'meldung' as const,
      erstellt_at: '2026-06-22T10:00:00Z',
      geaendert_at: '2026-06-22T10:00:00Z',
    };
    await entwurfSpeichern({ ...basis, id: 'a', inhalt: 'Erster', an: 'Florian Leitung' });
    await entwurfSpeichern({ ...basis, id: 'b', inhalt: 'Zweiter' });
    localStorage.setItem('etb-entwurf-aktiv-7', 'a');
    renderMitProviders(
      <EtbEntwurfsTabs
        {...props({ einsatz: { ...einsatz, meine_fuehrungsstelle: 'Standard' } })}
      />,
    );
    expect(await screen.findByDisplayValue('Erster')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByDisplayValue('Zweiter')).toBeInTheDocument();
    expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
  });

  it('öffnet mit einem leeren Entwurf-Tab und Eingabefeld', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    expect(await screen.findByPlaceholderText(/Inhalt/)).toBeInTheDocument();
  });

  it('autosaved Eingaben in IndexedDB', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Lagemeldung');
    await waitFor(async () => {
      const liste = await entwuerfeLaden(7);
      expect(liste[0]?.inhalt).toBe('Lagemeldung');
    });
  });

  it('entfernt den Entwurf nach erfolgreichem Absenden', async () => {
    const p = props();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Fertig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(0));
  });

  it('behält das Erfassungsfeld nach dem Absenden — auch unter StrictMode (LFH-214)', async () => {
    // Der e2e läuft über den Vite-Dev-Server, also unter React.StrictMode. Dort
    // desynchronisierte ein impurer setEntwuerfe-Updater in entwurfSchliessen
    // (setAktiverId/localStorage/leererEntwurf im Updater, doppelt invoked) entwuerfe
    // und aktiverId, sodass der neue leere Entwurf-Tab keinen aktiven Inhalt mehr
    // rendert → das Erfassungsfeld verschwand nach dem Absenden.
    const p = props();
    renderMitProviders(
      <StrictMode>
        <EtbEntwurfsTabs {...p} />
      </StrictMode>,
    );
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Fertig');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    // Neuer leerer Entwurf-Tab: Feld wieder vorhanden und leer.
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('');
  });

  it('behält den Entwurf, wenn das Absenden fachlich abgelehnt wird', async () => {
    // Die Ablehnung propagiert korrekt aus erfassenUndSchliessen → void absenden() →
    // unhandled rejection im Runner. Wir unterdrücken sie hier für diesen Test,
    // da es erwartetes Verhalten ist (Entwurf bleibt, Schließen wird nicht aufgerufen).
    const originalOnUnhandledRejection = process.listeners('unhandledRejection').slice();
    process.removeAllListeners('unhandledRejection');
    process.once('unhandledRejection', () => {
      /* erwartet */
    });

    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockRejectedValue(new Error('abgelehnt')),
    });
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Bleibt{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    // Entwurf wurde durch das Tippen persistiert und bleibt nach Reject erhalten.
    await waitFor(async () => {
      const liste = await entwuerfeLaden(7);
      expect(liste[0]?.inhalt).toBe('Bleibt');
    });

    // Listener wiederherstellen
    for (const listener of originalOnUnhandledRejection) {
      process.on('unhandledRejection', listener as NodeJS.UnhandledRejectionListener);
    }
  });

  // -------------------------------------------------------------------------
  // Wertübernahme über die Remount-Grenze (LFH-332/H61)
  //
  // Genau hier — und nur hier — ist der Fall prüfbar: nach erfolgreichem Erfassen
  // schließt dieser Container den Entwurfs-Tab, und das key-Prop erzwingt einen
  // Remount der Schnellerfassung. Ein Wert, der nur in deren useState läge, wäre
  // danach weg.
  // -------------------------------------------------------------------------

  async function setzeAnUndMeldeweg(feld: HTMLElement) {
    await userEvent.type(feld, ' /an');
    await userEvent.click(await screen.findByText('An'));
    await userEvent.type(await screen.findByLabelText('An'), 'Florian 1{Enter}');
    await userEvent.type(feld, ' /meldeweg');
    await userEvent.click(await screen.findByText('Meldeweg'));
    await userEvent.click(await screen.findByText('Funk'));
  }

  it('übernimmt An und Meldeweg in den nächsten Entwurf (Schalter an)', async () => {
    const p = props();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    // Vorgabe des Schalters ist AN.
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).toBeChecked();

    await userEvent.type(feld, 'Erste Meldung');
    await setzeAnUndMeldeweg(feld);
    await userEvent.type(feld, '{Enter}');

    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      an: 'Florian 1',
      meldeweg: 'funk',
    });

    // Der leere Inhalt beweist, dass wir den NEUEN Entwurf sehen: die alte Instanz ist
    // beim Schließen des Tabs unmountet worden und hat ihr Feld nie geleert.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('');
      expect(screen.getByText('An: Florian 1')).toBeInTheDocument();
      expect(screen.getByText('Meldeweg: Funk')).toBeInTheDocument();
    });

    // Kein Geister-Entwurf: Die übernommenen Chips dürfen den gerade gelöschten Entwurf
    // nicht wieder in den Speicher schreiben. Die Schnellerfassung setzt nach dem Erfassen
    // metadaten auf die Übernahme — träfe dieser Autosave noch den ALTEN Entwurf, wäre
    // `istLeer` wegen der gesetzten Metadaten falsch und der Entwurf käme leer zurück.
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(0));

    // …und sie werden beim nächsten Eintrag ohne erneutes Tippen mitgesendet.
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Zweite Meldung{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({
      inhalt: 'Zweite Meldung',
      an: 'Florian 1',
      meldeweg: 'funk',
    });
  });

  it('lässt den nächsten Entwurf leer, wenn der Schalter aus ist', async () => {
    const p = props();
    renderMitProviders(<MitSchalter {...p} />);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();

    await userEvent.type(feld, 'Erste Meldung');
    await setzeAnUndMeldeweg(feld);
    await userEvent.type(feld, '{Enter}');

    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      an: 'Florian 1',
      meldeweg: 'funk',
    });

    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    expect(screen.queryByText('An: Florian 1')).toBeNull();
    expect(screen.queryByText('Meldeweg: Funk')).toBeNull();
    // Der Schalterzustand selbst überlebt den Remount ebenfalls.
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it('öffnet über den +-Button einen zweiten Tab', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    // Antd rendert auch die Remove-Buttons mit role="tab"; nur Tab-Btn-Elemente zählen.
    await userEvent.click(screen.getByRole('button', { name: /add|hinzu/i }));
    await waitFor(() =>
      expect(screen.getAllByRole('tab', { name: /Neuer Eintrag/ })).toHaveLength(2),
    );
  });
});
