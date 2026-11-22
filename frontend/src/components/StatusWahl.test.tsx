import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import StatusWahl, { menueLage, type StatusOption } from './StatusWahl';
import type { StatusDarstellung } from '../theme/statusFarben';

/** Zweiter Kanal ist Pflicht — die Darstellungen werden hier von Hand gebaut, damit die
 *  Tests unabhängig von den konkreten Enum-Zuordnungen der drei Module bleiben. */
const frei: StatusDarstellung = { rolle: 'normal', label: '1 – Frei auf Funk' };
// „Am Einsatzort“ ist `gebunden` und damit neutral (Spec `statusrollen`, eon26eat D1).
const gebunden: StatusDarstellung = { rolle: 'neutral', label: '4 – Am Einsatzort' };

const OPTIONEN: StatusOption<number>[] = [
  { wert: 1, label: '1 – Frei auf Funk', darstellung: frei },
  { wert: 4, label: '4 – Am Einsatzort', darstellung: gebunden },
  {
    wert: 6,
    label: '6 – Nicht einsatzbereit',
    darstellung: { rolle: 'alarm', label: '6 – Nicht einsatzbereit' },
  },
];

const KENNUNG = 'Florian 44/1';

/**
 * Greift das GEÖFFNETE Menü-Portal. antd lässt die Portale geschlossener Dropdowns im
 * Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden` — deshalb
 * zusätzlich über `pointerEvents` filtern und genau einen Treffer verlangen.
 * Muster: `meldungen/MeldungKarte.test.tsx`.
 */
async function oeffneMenue(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(KENNUNG) }));
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
    (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
  );
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error('Das Statusmenü ließ sich nicht öffnen');
  return menue;
}

function aufbauen(props: Partial<React.ComponentProps<typeof StatusWahl<number>>> = {}) {
  const onWaehlen = vi.fn();
  renderMitProviders(
    <StatusWahl<number>
      darstellung={frei}
      optionen={OPTIONEN}
      kennung={KENNUNG}
      onWaehlen={onWaehlen}
      darfSchreiben
      {...props}
    />,
  );
  return { onWaehlen };
}

describe('StatusWahl', () => {
  it('öffnet mit dem Klick auf das Statusetikett ein Menü mit allen Werten', async () => {
    aufbauen();
    const menue = await oeffneMenue();
    // Teilstring statt exaktem Namen: ein Icon im Eintrag brächte ein eigenes `aria-label`
    // mit, das in den zugänglichen Namen einflösse (gemessen in LFH-366).
    for (const o of OPTIONEN) {
      expect(
        within(menue).getByRole('menuitem', { name: new RegExp(o.label) }),
      ).toBeInTheDocument();
    }
  });

  it('meldet den gewählten Wert', async () => {
    const { onWaehlen } = aufbauen();
    const menue = await oeffneMenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Am Einsatzort/ }));
    expect(onWaehlen).toHaveBeenCalledTimes(1);
    expect(onWaehlen).toHaveBeenCalledWith(4);
  });

  it('ohne Schreibrecht gibt es KEINEN Auslöser — das Etikett bleibt', () => {
    aufbauen({ darfSchreiben: false });
    // Die Negativaussage lautet „kein Auslöser", nicht „kein Menüeintrag": vor dem ersten
    // Öffnen ist `queryByRole('menuitem')` ohnehin immer null (rc-dropdown mountet lazy),
    // ein reiner Rollentausch färbte sie also trivial grün.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('1 – Frei auf Funk')).toBeInTheDocument();
  });

  it('trägt die Zeilenkennung im zugänglichen Namen — n Zeilen, n unterscheidbare Ziele', () => {
    aufbauen();
    const ausloeser = screen.getByRole('button', { name: /Florian 44\/1/ });
    expect(ausloeser).toBeInTheDocument();
    // Der sichtbare Text bleibt kurz; die Kennung lebt im Namen, nicht im Etikett.
    expect(ausloeser.textContent).not.toMatch(/Florian 44\/1/);
  });

  it('mit Schreibrecht ist der Status ein Knopf: Fläche, Rahmen in der Rollenkante, Pfeil (LLH-1780)', async () => {
    aufbauen();
    const knopf = screen.getByRole('button', { name: `Status von ${KENNUNG} ändern` });
    expect(knopf).toHaveAttribute('data-lfh', 'status-knopf');
    expect(knopf.style.borderStyle).toBe('solid');
    expect(knopf.style.borderColor).not.toBe(knopf.style.backgroundColor);
    expect(knopf.style.fontSize).toBe('14px');
    expect(knopf.querySelector('[data-lfh="status-pfeil"]')).toHaveTextContent('▾');

    // Auch im Menü: der Farbpunkt steht NEBEN dem Text, die Zeile bleibt ungefärbt.
    const menue = await oeffneMenue();
    const eintrag = within(menue).getByRole('menuitem', { name: /Nicht einsatzbereit/ });
    expect(eintrag.style.background).toBeFalsy();
    expect(eintrag.textContent).toMatch(/Nicht einsatzbereit/);
  });

  it('ohne Schreibrecht steht der randlose Status, ohne Pfeil (Rahmen heißt bedienbar)', () => {
    aufbauen({ darfSchreiben: false });
    const status = screen
      .getByText('1 – Frei auf Funk')
      .closest<HTMLElement>('[data-lfh="status"]')!;
    expect(status.style.border).toBe('');
    expect(document.querySelector('[data-lfh="status-pfeil"]')).toBeNull();
  });

  it('macht den Farbpunkt für Screenreader unsichtbar — er wiederholte nur das Etikett', async () => {
    aufbauen();
    const menue = await oeffneMenue();
    // Ein Icon mit eigener `img`-Rolle stünde in jeder Zeile als eigenes Vorleseziel. Die Icons
    // des Satzes sind `aria-hidden` (LFH-595); früher brachte antd ein englisches `aria-label` mit.
    expect(within(menue).queryByRole('img')).toBeNull();
  });

  it('markiert den aktuellen Wert im Menü — über den WERT, nicht über das Label', async () => {
    // Der Mandant darf sein Katalog-Label frei umbenennen; eine Markierung, die am Text
    // hinge, verlöre sich damit lautlos. Deshalb ein eigenes `aktuell`.
    aufbauen({ aktuell: 4, darstellung: { rolle: 'neutral', label: 'am Einsatzort (umbenannt)' } });
    const menue = await oeffneMenue();
    const gewaehlt = within(menue).getByRole('menuitem', { name: /Am Einsatzort/ });
    expect(gewaehlt.className).toMatch(/ant-dropdown-menu-item-selected/);
    expect(within(menue).getByRole('menuitem', { name: /Frei auf Funk/ }).className).not.toMatch(
      /ant-dropdown-menu-item-selected/,
    );
  });

  it('sperrt den Auslöser, solange geschrieben wird', () => {
    aufbauen({ laeuft: true });
    expect(screen.getByRole('button', { name: /Florian 44\/1/ })).toBeDisabled();
  });

  it('ohne gesetzten Status bleibt der Auslöser bedienbar', async () => {
    const { onWaehlen } = aufbauen({ darstellung: null });
    const menue = await oeffneMenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Frei auf Funk/ }));
    expect(onWaehlen).toHaveBeenCalledWith(1);
  });

  describe('Menü: Kopf und Lage (LLH-1781)', () => {
    it('mit `titel` steht der Rufname als Kopf über den Einträgen, nicht wählbar', async () => {
      renderMitProviders(
        <StatusWahl
          darstellung={gebunden}
          aktuell={4}
          optionen={OPTIONEN}
          kennung={KENNUNG}
          titel="85-1"
          onWaehlen={vi.fn()}
          darfSchreiben
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: `Status von ${KENNUNG} ändern` }));
      const kopf = await screen.findByText('85-1');
      expect(kopf).toHaveAttribute('data-lfh', 'status-menue-kopf');
      expect(kopf.closest('[role="menuitem"]')).toBeNull();
    });

    it('mit `titel` fokussiert das Öffnen den gewählten Eintrag, ohne zu scrollen (LLH-2003)', async () => {
      // Der Fokus fällt mitten in die Einblendung, nachdem `menueLage` gemessen hat. Ein
      // scrollendes `focus()` verschob das Fenster (Handschuh 1366 × 520: Menü ragte unten
      // heraus) oder rollte ein langes Menü nach unten (S1 bis S3 weg). rc-dropdown fokussiert
      // aus demselben Grund mit `preventScroll`.
      const fokus = vi.spyOn(HTMLElement.prototype, 'focus');
      renderMitProviders(
        <StatusWahl
          darstellung={gebunden}
          aktuell={4}
          optionen={OPTIONEN}
          kennung={KENNUNG}
          titel="85-1"
          onWaehlen={vi.fn()}
          darfSchreiben
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: `Status von ${KENNUNG} ändern` }));
      const gewaehlt = await screen.findByRole('menuitem', { name: /4 – Am Einsatzort/ });
      await vi.waitFor(() => expect(gewaehlt).toHaveFocus());
      const aufrufe = fokus.mock.contexts
        .map((ziel, i) => ({ ziel, optionen: fokus.mock.calls[i][0] }))
        .filter(({ ziel }) => (ziel as HTMLElement).getAttribute?.('role') === 'menuitem');
      fokus.mockRestore();
      expect(aufrufe.length, 'Vorbedingung: ein Eintrag wurde fokussiert').toBeGreaterThan(0);
      for (const { optionen } of aufrufe) expect(optionen).toEqual({ preventScroll: true });
    });

    it('`gross`: der Statusblock trägt die große Ziffer, ohne Schreibrecht ohne Rahmen', () => {
      const { unmount } = renderMitProviders(
        <StatusWahl
          darstellung={gebunden}
          code="4"
          variante="gross"
          optionen={OPTIONEN}
          kennung={KENNUNG}
          onWaehlen={vi.fn()}
          darfSchreiben
        />,
      );
      const knopf = screen.getByRole('button', { name: `Status von ${KENNUNG} ändern` });
      expect(knopf).toHaveAttribute('data-variante', 'gross');
      expect(within(knopf).getByText('4')).toHaveStyle({ fontSize: '40px' });
      unmount();
      renderMitProviders(
        <StatusWahl
          darstellung={gebunden}
          code="4"
          variante="gross"
          optionen={OPTIONEN}
          kennung={KENNUNG}
          onWaehlen={vi.fn()}
          darfSchreiben={false}
        />,
      );
      const block = document.querySelector<HTMLElement>('[data-lfh="status-block"]')!;
      expect(block.style.border).toBe('');
      expect(within(block).getByText('4')).toHaveStyle({ fontSize: '40px' });
    });
  });

  describe('menueLage (D7)', () => {
    const ausloeser = (top: number, bottom: number) =>
      ({ getBoundingClientRect: () => ({ top, bottom }) }) as unknown as HTMLElement;

    it('öffnet nach unten, wenn es dort passt', () => {
      expect(menueLage(ausloeser(100, 130), 10, 30, 'kompakt', '85-1', 900)).toEqual({
        unten: true,
        maxHoehe: 754,
        spalten: 1,
      });
    });

    it('kippt nach oben, wenn unten der Platz fehlt und oben mehr ist', () => {
      const l = menueLage(ausloeser(700, 730), 10, 30, 'kompakt', '85-1', 768);
      expect(l.unten).toBe(false);
      expect(l.maxHoehe).toBe(684);
    });

    it('bleibt unten mit begrenzter Höhe, wenn unten mehr Platz ist als oben', () => {
      const l = menueLage(ausloeser(40, 70), 10, 48, 'komfortabel', undefined, 500);
      expect(l).toEqual({ unten: true, maxHoehe: 414, spalten: 1 });
    });

    it('Handschuh: zweispaltig, sobald eine Spalte nicht auf die größere Seite passt', () => {
      expect(menueLage(ausloeser(100, 172), 10, 72, 'handschuh', '85-1', 900).spalten).toBe(2);
      expect(menueLage(ausloeser(100, 172), 3, 72, 'handschuh', '85-1', 520).spalten).toBe(1);
      expect(menueLage(ausloeser(100, 130), 10, 30, 'kompakt', '85-1', 200).spalten).toBe(1);
    });

    it('Handschuh: dreispaltig, wenn auch zwei Spalten nicht passen (1366 × 520, Knopf unten)', () => {
      // Gemessen im Browser: Knopf bei 385–457 px, oben 369 px Platz. Zwei Spalten brauchen
      // fünf Zeilen à 74 px und den Kopf, drei Spalten vier Zeilen.
      const l = menueLage(ausloeser(385, 457), 10, 72, 'handschuh', '85-1', 520);
      expect(l).toEqual({ unten: false, maxHoehe: 369, spalten: 3 });
    });
  });
});
