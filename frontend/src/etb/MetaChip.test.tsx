import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import { zuWerte, type EtbEntwurf } from './entwuerfe/entwurfModell';
import MetaChip from './MetaChip';

dayjs.extend(utc);

const ENTWURF_LEER: EtbEntwurf = {
  id: 'a',
  benutzer_id: 1,
  einsatz_id: 7,
  inhalt: '',
  typ: 'meldung',
  erstellt_at: '2026-07-14T09:00:00.000Z',
  geaendert_at: '2026-07-14T09:00:00.000Z',
};

describe('MetaChip', () => {
  it('Text-Feld: Editor offen, Enter committet den Wert', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Von');
    await userEvent.type(input, 'ELW 1{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'ELW 1');
  });

  it('geschlossen: zeigt Label+Wert', () => {
    renderMitProviders(
      <MetaChip
        feld="meldeweg"
        editing={false}
        wert="funk"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(/Meldeweg/)).toBeInTheDocument();
    expect(screen.getByText(/Funk/)).toBeInTheDocument();
  });

  /**
   * Der Ersatz für das ~10-px-Kreuz (LFH-365): ein benannter Auslöser, der seine Höhe vom
   * `ConfigProvider` erbt — der Tag-Rumpf selbst trägt weder `role` noch `tabindex`.
   *
   * Der Name trägt das FELD (`Aktionen zu Von`): die Chip-Leiste zeigt mehrere Chips, und n
   * gleichnamige Knöpfe sind per Rolle nicht unterscheidbar (wie LFH-364).
   */
  it('geschlossen: das Aktionsmenü trägt das Feld im Namen', () => {
    renderMitProviders(
      <MetaChip
        feld="von"
        editing={false}
        wert="ELW 1"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Aktionen zu Von' })).toBeInTheDocument();
    // Das alte Kreuz ist ERSETZT, nicht ergänzt: sonst bliebe das 10-px-Ziel die schnellste
    // Bedienung.
    expect(screen.queryByLabelText('schließen')).not.toBeInTheDocument();
  });

  /**
   * `onEdit` NICHT gerufen ist kein Beiwerk: das Menü-Overlay ist ein React-Kind des Chips, und
   * ein Synthetic Event steigt durch den KOMPONENTEN-Baum auf — auch aus einem Portal heraus.
   * Ohne Riegel entfernte „Entfernen" das Feld und öffnete es im selben Zug zum Bearbeiten.
   */
  it('Menü „Entfernen" ruft onRemove — und NICHT onEdit', async () => {
    const onRemove = vi.fn();
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="meldeweg"
        editing={false}
        wert="funk"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={onRemove}
        onEdit={onEdit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Meldeweg' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Entfernen' }));
    expect(onRemove).toHaveBeenCalledWith('meldeweg');
    expect(onEdit).not.toHaveBeenCalled();
  });

  /**
   * Ein Fehlgriff darf nichts tun. Das Menü-Overlay trägt rings um seine Einträge ein
   * 4-px-Polsterband (`dropdownEdgeChildPadding` → `paddingXXS`, in jeder Dichtestufe gleich
   * schmal). Ein Klick darauf schließt das Menü ohne Aktion, und stiege das Event zum Chip auf,
   * schaltete es ihn in den Editor, der per `autoFocus` den Fokus aus dem Inhaltsfeld zieht.
   *
   * Ein Riegel am Menü-`onClick` fängt das nicht: der feuert nur für Einträge.
   */
  it('ein Klick auf die Polsterung des Menüs tut nichts', async () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing={false}
        wert="ELW 1"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={onRemove}
        onEdit={onEdit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Von' }));
    await userEvent.click(await screen.findByRole('menu'));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('Menü „Bearbeiten" ruft onEdit', async () => {
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing={false}
        wert="ELW 1"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={onEdit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Von' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));
    expect(onEdit).toHaveBeenCalledWith('von');
  });

  /**
   * Der Maus-Schnellweg bleibt: ein Klick auf den Chip-Rumpf öffnet den Editor. Pin auf
   * Bestandsverhalten, damit ein Umbau ihn nicht stillschweigend mitnimmt.
   */
  it('Klick auf den Chip-Rumpf bleibt der Schnellweg zum Bearbeiten', async () => {
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing={false}
        wert="ELW 1"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={onEdit}
      />,
    );
    await userEvent.click(screen.getByText(/ELW 1/));
    expect(onEdit).toHaveBeenCalledWith('von');
  });

  it('Escape im Editor ruft onCancel', async () => {
    const onCancel = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        onCommit={vi.fn()}
        onCancel={onCancel}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('Von'), '{Escape}');
    expect(onCancel).toHaveBeenCalledWith('von');
  });

  it('Text-Feld mit Optionen: AutoComplete, Freitext bleibt per Enter möglich', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        optionen={['Florian 1', 'RTW 1']}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(input, 'Eigener Text{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'Eigener Text');
  });

  it('Text-Feld mit Optionen: Klick auf Vorschlag committet sofort (onSelect)', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        optionen={['Florian 1', 'RTW 1']}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(input, 'Florian');
    // Der echte klickbare Eintrag ist `.ant-select-item-option` (der role="option"-Knoten
    // ist nur das a11y-Spiegelelement und reagiert nicht auf Klicks).
    const eintrag = await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === 'Florian 1',
    );
    await userEvent.click(eintrag);
    expect(onCommit).toHaveBeenCalledWith('von', 'Florian 1');
  });

  /**
   * Die Chip-Eingabe steht in der angepinnten Erfassungsleiste am Seitenfuß. Reacts
   * `autoFocus` ruft `focus()` OHNE Optionen, und der native Fokus rollte die Seite — wer oben
   * im Tagebuch las, verlöre seine Stelle. Der Fokus kommt deshalb mit `preventScroll` (LFH-373).
   */
  it.each([
    ['von', ['ELW 1', 'Leitstelle']],
    ['von', undefined],
    ['veranlassung', undefined],
    ['meldeweg', undefined],
    ['ereigniszeit', undefined],
  ] as const)('%s (Vorschläge: %s): fokussiert ohne die Seite zu rollen', (feld, optionen) => {
    const fokus = vi.spyOn(HTMLElement.prototype, 'focus');
    renderMitProviders(
      <MetaChip
        feld={feld}
        editing
        wert={undefined}
        optionen={optionen ? [...optionen] : undefined}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const beschriftung = {
      von: 'Von',
      veranlassung: 'Veranlassung',
      meldeweg: 'Meldeweg',
      ereigniszeit: 'Ereigniszeit',
    }[feld];
    const eingabe = screen.getByLabelText(beschriftung);
    expect(eingabe).toHaveFocus();
    const aufrufe = fokus.mock.calls;
    expect(aufrufe.length).toBeGreaterThan(0);
    expect(
      aufrufe.every(([opt]) => (opt as FocusOptions | undefined)?.preventScroll === true),
    ).toBe(true);
    fokus.mockRestore();
  });

  /**
   * LFH-748: ein Editor, der beim Absenden schon offen war, nimmt während des Sendens nichts an —
   * wie jede andere Eingabe der Erfassung. Vorher blieb er bedienbar, und die Übernahme stieg
   * nur still aus.
   */
  it.each([
    ['von', ['ELW 1', 'Leitstelle'], 'Von'],
    ['von', undefined, 'Von'],
    ['meldeweg', undefined, 'Meldeweg'],
    ['ereigniszeit', undefined, 'Ereigniszeit'],
  ] as const)(
    '%s (Vorschläge: %s): gesperrt ist der offene Editor nicht bedienbar',
    async (feld, optionen, name) => {
      const onCommit = vi.fn();
      renderMitProviders(
        <MetaChip
          feld={feld}
          editing
          gesperrt
          wert={undefined}
          optionen={optionen ? [...optionen] : undefined}
          onCommit={onCommit}
          onCancel={vi.fn()}
          onRemove={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
      const eingabe = screen.getByLabelText(name);
      expect(eingabe).toBeDisabled();
      await userEvent.type(eingabe, 'ELW 1{Enter}');
      expect(onCommit).not.toHaveBeenCalled();
    },
  );
});

/**
 * LFH-692 (Spec `zeiteingabe`, Szenario „Wiederhergestellter Entwurf“): ein Entwurf stellt seine
 * Ereigniszeit als UTC-Zeitpunkt wieder her (`entwurfModell.zuWerte`). Der Chip formatierte das
 * Objekt in SEINEM Modus und zeigte 1000 statt 1200.
 */
describe('MetaChip — Ereigniszeit in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  const BERLIN = { zeitzone: 'Europe/Berlin' };

  it('ein wiederhergestellter Entwurf zeigt 1200 für 10:00 UTC', () => {
    const wert = zuWerte({ ...ENTWURF_LEER, ereigniszeit: '2026-07-14T10:00:00.000Z' }).metadaten
      .ereigniszeit;
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <MetaChip
          feld="ereigniszeit"
          editing={false}
          wert={wert}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
          onRemove={vi.fn()}
          onEdit={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    expect(screen.getByText(/1200/)).toBeInTheDocument();
    expect(screen.queryByText(/1000/)).not.toBeInTheDocument();
  });

  it('der Editor zeigt die Berliner Uhrzeit und übernimmt mit OK den Zeitpunkt', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <MetaChip
          feld="ereigniszeit"
          editing
          wert={dayjs.utc('2026-07-14 10:00:00')}
          onCommit={onCommit}
          onCancel={vi.fn()}
          onRemove={vi.fn()}
          onEdit={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const feld = screen.getByRole('textbox', { name: 'Ereigniszeit' });
    expect(feld).toHaveValue('2026-07-14 12:00:00');
    await userEvent.click(feld);
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect((onCommit.mock.calls[0][1] as dayjs.Dayjs).toISOString()).toBe(
      '2026-07-14T10:00:00.000Z',
    );
  });
});

/** LFH-895: Der Editor eines leeren Zeit-Chips schlägt „jetzt“ nach der Serveruhr vor. */
describe('MetaChip — Vorschlag eines vorgehenden Geräts (LFH-895)', () => {
  mitProzessZone('UTC');
  const SERVER = Date.parse('2026-10-04T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER + 5 * 60_000);
    serveruhrVergessenFuerTests();
    merkeServerzeit(new Response(null, { headers: { Date: new Date(SERVER).toUTCString() } }));
    return () => {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    };
  });

  it('schlägt die Serverzeit vor, und OK übernimmt sie', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="ereigniszeit"
        editing
        wert={undefined}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const feld = screen.getByRole('textbox', { name: 'Ereigniszeit' });
    expect(feld).toHaveValue('2026-10-04 10:00:00');
    await userEvent.click(feld);
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const ms = (onCommit.mock.calls[0][1] as dayjs.Dayjs).valueOf();
    expect(Math.abs(ms - SERVER)).toBeLessThanOrEqual(1_000);
  });
});
