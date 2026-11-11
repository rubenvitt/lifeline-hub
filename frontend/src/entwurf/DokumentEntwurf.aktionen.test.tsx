/**
 * Aktionen eines Abschnitts (LLH-1601, Spec `dokument-entwurf`,
 * `openspec/changes/archive/2026-11-09-amp1au76-gliederung-kontextmenue/design.md`): ⋮ im Abschnittskopf mit
 * „Text kopieren“, „In der Lesefassung zeigen“ und „Abschnitt leeren“; dieselben Einträge als
 * Kontextmenü am Kopf, in der Gliederung mit „Zum Abschnitt springen“ davor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp, Form } from 'antd';
import DokumentEntwurf, { type AbschnittAktion } from './DokumentEntwurf';
import { vorlage } from '../lageberichte/vorlagen';
import { warteAufMenueFokus } from '../test/menue';

const acht = vorlage('lagebeurteilung')!.abschnitte;
const [erster, zweiter, dritter] = acht;

function Pruefling({
  start,
  onValuesChange,
  aktion,
}: {
  start?: Record<string, string>;
  onValuesChange?: (geaendert: Record<string, unknown>) => void;
  aktion?: AbschnittAktion;
}) {
  const [form] = Form.useForm();
  return (
    <AntApp>
      <Form form={form} layout="vertical" initialValues={start} onValuesChange={onValuesChange}>
        <DokumentEntwurf form={form} abschnitte={acht} aktion={aktion} einstieg={undefined} />
      </Form>
    </AntApp>
  );
}

const gliederung = () => screen.getByRole('navigation', { name: 'Gliederung' });
const sprungknopf = (label: string) =>
  within(gliederung()).getByRole('button', { name: new RegExp(`^${label}( leer)?$`) });
const offenesMenue = (name: string) =>
  document.querySelector<HTMLElement>(
    `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label="${name}"]`,
  );
const eintraege = (menue: HTMLElement) =>
  within(menue)
    .getAllByRole('menuitem')
    .map((e) => e.textContent);
const kopfVon = (label: string) =>
  screen
    .getByRole('heading', { level: 3, name: label })
    .closest<HTMLElement>('[data-lfh="abschnitt-kopf"]')!;

/**
 * Das ⋮-Menü trägt seinen Namen am Auslöser, nicht am Menü (`MenueAusloeser`). Gewählt wird erst,
 * wenn der späte `autoFocus`-Aufruf des Menüs verbraucht ist: sonst zieht er unter Last den Fokus,
 * den eine Aktion gerade gesetzt hat, ins geschlossene Menü zurück (LLH-1644, `test/menue.ts`).
 */
async function openDreipunkt(label: string) {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Abschnitt ${label}` }));
  const menue = await waitFor(() =>
    document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]:not([aria-label])',
    )!,
  );
  await warteAufMenueFokus();
  return menue;
}

const scrollIntoView = vi.fn();
/** Das Element des letzten `scrollIntoView` (lib ohne `Array.prototype.at`). */
const lastScrollTarget = () =>
  scrollIntoView.mock.instances[scrollIntoView.mock.instances.length - 1] as unknown as HTMLElement;
const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  scrollIntoView.mockClear();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = scrollIntoView;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

describe('DokumentEntwurf — ⋮ im Abschnittskopf', () => {
  it('trägt je Abschnitt ein ⋮ im Kopf mit Kopieren, Lesefassung und rot dem Leeren', async () => {
    render(<Pruefling start={{ [erster.schluessel]: 'Text' }} />);
    const knopf = within(kopfVon(erster.label)).getByRole('button', {
      name: `Aktionen zu Abschnitt ${erster.label}`,
    });
    expect(knopf).toBeVisible();
    // Kein ⋮ in der Gliederung: die trägt nur Sprünge.
    expect(within(gliederung()).getAllByRole('button')).toHaveLength(8);

    const menue = await openDreipunkt(erster.label);
    expect(eintraege(menue)).toEqual([
      'Text kopieren',
      'In der Lesefassung zeigen',
      'Abschnitt leeren',
    ]);
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    expect(within(menue).getByRole('menuitem', { name: 'Abschnitt leeren' })).toHaveClass(
      'ant-dropdown-menu-item-danger',
    );
  });
});

describe('DokumentEntwurf — Text kopieren', () => {
  it('legt den ungespeicherten Text in die Zwischenablage und nennt den Abschnitt', async () => {
    render(<Pruefling />);
    fireEvent.change(screen.getByRole('textbox', { name: erster.label }), {
      target: { value: 'Lage **ruhig**' },
    });
    const menue = await openDreipunkt(erster.label);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Text kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Lage **ruhig**'));
    expect(await screen.findByText(`Text von „${erster.label}“ kopiert`)).toBeInTheDocument();
  });

  it('meldet einen Fehlschlag der Zwischenablage', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    render(<Pruefling start={{ [erster.schluessel]: 'Text' }} />);
    const menue = await openDreipunkt(erster.label);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Text kopieren' }));
    expect(await screen.findByText('Kopieren fehlgeschlagen')).toBeInTheDocument();
  });

  it('sperrt Kopieren und Leeren bei leerem Abschnitt', async () => {
    render(<Pruefling />);
    const menue = await openDreipunkt(zweiter.label);
    for (const name of ['Text kopieren', 'Abschnitt leeren']) {
      expect(within(menue).getByRole('menuitem', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    expect(
      within(menue).getByRole('menuitem', { name: 'In der Lesefassung zeigen' }),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('sperrt den Eintrag ohne Zwischenablage', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(<Pruefling start={{ [erster.schluessel]: 'Text' }} />);
    const menue = await openDreipunkt(erster.label);
    expect(within(menue).getByRole('menuitem', { name: 'Text kopieren' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('DokumentEntwurf — In der Lesefassung zeigen', () => {
  it('schaltet auf die Lesefassung, rollt zum Abschnitt und setzt den Fokus dorthin', async () => {
    render(<Pruefling />);
    const menue = await openDreipunkt(dritter.label);
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: 'In der Lesefassung zeigen' }),
    );
    expect(screen.getByRole('tab', { name: 'Lesefassung' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const lesen = screen.getByRole('tabpanel', { name: 'Lesefassung' });
    const ziel = within(lesen)
      .getByRole('heading', { level: 3, name: dritter.label })
      .closest('section')!;
    await waitFor(() => expect(ziel).toHaveFocus());
    expect(lastScrollTarget()).toBe(ziel);
  });
});

describe('DokumentEntwurf — Abschnitt leeren', () => {
  it('fragt nach; Abbrechen lässt den Text, Bestätigen leert wie Löschen von Hand', async () => {
    const onValuesChange = vi.fn();
    render(
      <Pruefling
        start={{ [zweiter.schluessel]: 'Auftrag steht' }}
        onValuesChange={onValuesChange}
      />,
    );
    const feld = screen.getByRole('textbox', { name: zweiter.label });

    let menue = await openDreipunkt(zweiter.label);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Abschnitt leeren' }));
    let dialog = await screen.findByRole('dialog', {
      name: `Abschnitt „${zweiter.label}“ leeren?`,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(feld).toHaveValue('Auftrag steht');
    expect(onValuesChange).not.toHaveBeenCalled();

    menue = await openDreipunkt(zweiter.label);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Abschnitt leeren' }));
    dialog = await screen.findByRole('dialog', { name: `Abschnitt „${zweiter.label}“ leeren?` });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschnitt leeren' }));

    expect(feld).toHaveValue('');
    // Derselbe Weg wie beim Tippen: die Seite hört es an `onValuesChange` (Verlustschutz, Stand
    // der Übernahme).
    expect(onValuesChange).toHaveBeenCalledTimes(1);
    expect(onValuesChange.mock.calls[0][0]).toEqual({ [zweiter.schluessel]: '' });
    await waitFor(() =>
      expect(
        within(gliederung()).getByRole('button', { name: `${zweiter.label} leer` }),
      ).toBeVisible(),
    );
    expect(screen.getByText('0/8 Abschnitte')).toBeVisible();
  });
});

describe('DokumentEntwurf — Kontextmenü an Gliederung und Kopf', () => {
  it('Rechtsklick in der Gliederung: „Zum Abschnitt springen“ zuoberst, dann die Einträge', async () => {
    render(<Pruefling start={{ [zweiter.schluessel]: 'Text' }} />);
    expect(
      fireEvent.contextMenu(sprungknopf(zweiter.label), { clientX: 40, clientY: 80, button: 2 }),
    ).toBe(false);
    const menue = await waitFor(() =>
      offenesMenue(`Aktionen zu Abschnitt ${zweiter.label} in der Gliederung`)!,
    );
    expect(eintraege(menue)).toEqual([
      'Zum Abschnitt springen',
      'Text kopieren',
      'In der Lesefassung zeigen',
      'Abschnitt leeren',
    ]);
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);

    await warteAufMenueFokus();
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Zum Abschnitt springen' }));
    const feld = screen.getByRole('textbox', { name: zweiter.label });
    await waitFor(() => expect(feld).toHaveFocus());
    expect(lastScrollTarget()).toBe(feld.closest('section'));
  });

  it('Rechtsklick auf den Abschnittskopf zeigt die Einträge des ⋮', async () => {
    render(<Pruefling />);
    const titel = within(kopfVon(dritter.label)).getByRole('heading', { level: 3 });
    expect(fireEvent.contextMenu(titel, { button: 2 })).toBe(false);
    const menue = await waitFor(() => offenesMenue(`Aktionen zu Abschnitt ${dritter.label}`)!);
    expect(eintraege(menue)).toEqual([
      'Text kopieren',
      'In der Lesefassung zeigen',
      'Abschnitt leeren',
    ]);
  });

  it('im Textfeld bleibt das Browsermenü', () => {
    render(<Pruefling />);
    const feld = screen.getByRole('textbox', { name: erster.label });
    expect(fireEvent.contextMenu(feld, { button: 2 })).toBe(true);
    expect(document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)')).toBeNull();
  });

  it('Leeren aus dem Kontextmenü fragt dieselbe Rückfrage', async () => {
    const onValuesChange = vi.fn();
    render(<Pruefling start={{ [erster.schluessel]: 'x' }} onValuesChange={onValuesChange} />);
    fireEvent.contextMenu(sprungknopf(erster.label), { button: 2 });
    const menue = await waitFor(() =>
      offenesMenue(`Aktionen zu Abschnitt ${erster.label} in der Gliederung`)!,
    );
    await warteAufMenueFokus();
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Abschnitt leeren' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Abschnitt „${erster.label}“ leeren?`,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschnitt leeren' }));
    expect(screen.getByRole('textbox', { name: erster.label })).toHaveValue('');
    expect(onValuesChange).toHaveBeenCalledWith({ [erster.schluessel]: '' }, expect.anything());
  });

  it('Umschalt+F10 auf dem Gliederungseintrag öffnet, Escape gibt den Fokus zurück', async () => {
    render(<Pruefling />);
    const knopf = sprungknopf(dritter.label);
    knopf.focus();
    expect(fireEvent.keyDown(knopf, { key: 'F10', shiftKey: true })).toBe(false);
    await waitFor(() =>
      expect(
        offenesMenue(`Aktionen zu Abschnitt ${dritter.label} in der Gliederung`),
      ).not.toBeNull(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(knopf).toHaveFocus());
  });

  it('in der Lesefassung fehlt „In der Lesefassung zeigen“, der Sprung zielt auf die Lesefassung', async () => {
    render(<Pruefling />);
    await userEvent.click(screen.getByRole('tab', { name: 'Lesefassung' }));
    fireEvent.contextMenu(sprungknopf(dritter.label), { button: 2 });
    const menue = await waitFor(() =>
      offenesMenue(`Aktionen zu Abschnitt ${dritter.label} in der Gliederung`)!,
    );
    expect(eintraege(menue)).toEqual([
      'Zum Abschnitt springen',
      'Text kopieren',
      'Abschnitt leeren',
    ]);
    await warteAufMenueFokus();
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Zum Abschnitt springen' }));
    const lesen = screen.getByRole('tabpanel', { name: 'Lesefassung' });
    await waitFor(() => expect(lesen).toContainElement(lastScrollTarget()));
  });
});

describe('DokumentEntwurf — Memoisierung mit Menü', () => {
  it('Öffnen und Schließen des Kontextmenüs rendert keinen Abschnitt neu', async () => {
    let n = 0;
    const aktion: AbschnittAktion = () => {
      n += 1;
      return null;
    };
    render(<Pruefling aktion={aktion} />);
    await waitFor(() => expect(n).toBeGreaterThanOrEqual(8));
    n = 0;
    fireEvent.contextMenu(sprungknopf(erster.label), { button: 2 });
    await waitFor(() =>
      expect(
        offenesMenue(`Aktionen zu Abschnitt ${erster.label} in der Gliederung`),
      ).not.toBeNull(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(offenesMenue(`Aktionen zu Abschnitt ${erster.label} in der Gliederung`)).toBeNull(),
    );
    expect(n).toBe(0);
  });
});
