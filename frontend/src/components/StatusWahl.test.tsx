import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import StatusWahl, { type StatusOption } from './StatusWahl';
import type { StatusDarstellung } from '../theme/statusFarben';

/** Zweiter Kanal ist Pflicht — die Darstellungen werden hier von Hand gebaut, damit die
 *  Tests unabhängig von den konkreten Enum-Zuordnungen der drei Module bleiben. */
const frei: StatusDarstellung = { rolle: 'normal', label: '1 – Frei auf Funk' };
const gebunden: StatusDarstellung = { rolle: 'achtung', label: '4 – Am Einsatzort' };

const OPTIONEN: StatusOption<number>[] = [
  { wert: 1, label: '1 – Frei auf Funk', darstellung: frei },
  { wert: 4, label: '4 – Am Einsatzort', darstellung: gebunden },
  { wert: 6, label: '6 – Nicht einsatzbereit', darstellung: { rolle: 'alarm', label: '6 – Nicht einsatzbereit' } },
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
      expect(within(menue).getByRole('menuitem', { name: new RegExp(o.label) })).toBeInTheDocument();
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

  it('trennt die Statusfarbe am Rand vom lesbaren Wortlaut, ohne Hintergrundfläche', async () => {
    aufbauen();
    const etikett = screen.getByText('1 – Frei auf Funk').closest('.ant-tag') as HTMLElement;
    expect(etikett.style.background).toBe('transparent');
    expect(etikett.style.borderColor).not.toBe(etikett.style.color);

    // Auch im Menü: der Farbpunkt steht NEBEN dem Text, die Zeile bleibt ungefärbt.
    const menue = await oeffneMenue();
    const eintrag = within(menue).getByRole('menuitem', { name: /Nicht einsatzbereit/ });
    expect(eintrag.style.background).toBeFalsy();
    expect(eintrag.textContent).toMatch(/Nicht einsatzbereit/);
  });

  it('macht den Farbpunkt für Screenreader unsichtbar — er wiederholte nur das Etikett', async () => {
    aufbauen();
    const menue = await oeffneMenue();
    // Ein `@ant-design/icons`-Knoten brächte ein eigenes englisches `aria-label` mit und
    // stünde dann in jeder Zeile als eigenes Vorleseziel (Regel „Ein Emoji ist keine Ikone").
    expect(within(menue).queryByRole('img')).toBeNull();
  });

  it('markiert den aktuellen Wert im Menü — über den WERT, nicht über das Label', async () => {
    // Der Mandant darf sein Katalog-Label frei umbenennen; eine Markierung, die am Text
    // hinge, verlöre sich damit lautlos. Deshalb ein eigenes `aktuell`.
    aufbauen({ aktuell: 4, darstellung: { rolle: 'achtung', label: 'am Einsatzort (umbenannt)' } });
    const menue = await oeffneMenue();
    const gewaehlt = within(menue).getByRole('menuitem', { name: /Am Einsatzort/ });
    expect(gewaehlt.className).toMatch(/ant-dropdown-menu-item-selected/);
    expect(
      within(menue).getByRole('menuitem', { name: /Frei auf Funk/ }).className,
    ).not.toMatch(/ant-dropdown-menu-item-selected/);
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
});
