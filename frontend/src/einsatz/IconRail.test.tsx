import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten, farbenDunkel, rahmenFarben } from '../theme/tokens';
import IconRail, { railZielStil } from './IconRail';
import { kategorien } from './modulRegistry';

/**
 * Legt die Token-Werte des UMGEBENDEN Providers als data-Attribute ab, nicht über
 * `theme.getDesignToken()`: nur so ist derselbe Token im Spiel, den die Komponente sieht.
 */
function TokenSonde() {
  const { token } = theme.useToken();
  return <div data-testid="token" data-bedien={token.colorPrimary} data-alarm={token.colorError} />;
}

describe('IconRail', () => {
  it('rendert je Kategorie einen Button mit Label als aria-label', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    for (const k of kategorien) {
      expect(screen.getByRole('button', { name: k.label })).toBeInTheDocument();
    }
  });

  it('markiert die aktive Kategorie via aria-current', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Lage' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Führung' })).not.toHaveAttribute('aria-current');
  });

  // LFH-595 (Spec `iconsatz`, „Aktiver Zustand über das gefüllte Icon“): die Füllung ist ein
  // ZUSÄTZLICHER Kanal neben Fläche und Marke. Geprüft über `data-lfh-icon` (Registername, die
  // gefüllte Fassung trägt `.gefuellt`), nicht über Pfaddaten.
  it('zeigt die aktive Kategorie gefüllt und alle anderen als Umriss', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />,
    );
    const iconIn = (name: string) =>
      screen
        .getByRole('button', { name })
        .querySelector('[data-lfh-icon]')
        ?.getAttribute('data-lfh-icon');
    expect(iconIn('Lage')).toMatch(/\.gefuellt$/);
    for (const k of kategorien.filter((k) => k.key !== 'lage')) {
      expect(iconIn(k.label), k.label).toBeDefined();
      expect(iconIn(k.label), k.label).not.toMatch(/\.gefuellt$/);
    }
  });

  it('zeigt ohne aktive Kategorie nur Umrisse (Gegenprobe)', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    const namen = kategorien.map((k) =>
      screen
        .getByRole('button', { name: k.label })
        .querySelector('[data-lfh-icon]')
        ?.getAttribute('data-lfh-icon'),
    );
    expect(namen.every((n) => n && !n.endsWith('.gefuellt'))).toBe(true);
  });

  // Die aktive Kategorie trägt eine 2-px-Marke in der BEDIENFARBE auf NEUTRALER Fläche, wie das
  // aktive Modul im Modulpanel (Spec `farbrollen-kontrast`, „Die Ortsmarke im Rahmen trägt die
  // Bedienfarbe“; Change `eon26eat-farbe-entlasten` D7). Vorher Markenrot mit 2,28 : 1, gegen
  // „Rot bedient nichts“. Gepinnt, weil der Gate-5-Hexscan nur sieht, DASS kein Literal dasteht.
  it('markiert die aktive Kategorie mit der Bedienmarke auf neutraler Fläche (eon26eat D7)', () => {
    renderMitProviders(
      <>
        <TokenSonde />
        <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />
      </>,
    );
    const alarm = screen.getByTestId('token').getAttribute('data-alarm')!;
    const aktiv = screen.getByRole('button', { name: 'Lage' });
    // Die Marke ist die Bedienrolle des Rahmens, nicht die Alarm- und nicht die Markenrolle.
    expect(aktiv.style.boxShadow).toContain('2px 0 0');
    // Die Farbe am Element, nicht nur an der Konstante: die Bedienrolle des Rahmens.
    expect(aktiv.style.boxShadow).toContain(rahmenFarben.bedien);
    expect(rahmenFarben.bedien).toBe(farbenDunkel.bedien);
    expect(rahmenFarben.bedien).not.toBe(alarm);
    expect(rahmenFarben.bedien).not.toBe(farbenDunkel.marke);
    // Die FLÄCHE ist neutral (`flaeche3`), keine rote und keine blaue Vollfläche mehr.
    expect(aktiv).toHaveStyle({ backgroundColor: rahmenFarben.aktiv });
    expect(aktiv).not.toHaveStyle({ backgroundColor: farbenDunkel.bedien });
    expect(aktiv).not.toHaveStyle({ backgroundColor: farbenDunkel.marke });

    // Gegenprobe: die inaktive Kategorie trägt weder Marke noch Fläche — sonst wäre die
    // Aussage oben trivial.
    const inaktiv = screen.getByRole('button', { name: 'Führung' });
    expect(inaktiv.style.boxShadow).toBe('none');
    expect(inaktiv).not.toHaveStyle({ backgroundColor: rahmenFarben.aktiv });
    // Inaktiv heißt nicht gesperrt: das Etikett ist bedienbarer Text und hält die Tag-Schwelle
    // (LFH-434, Zahl in `theme/rahmenKontrast.test.ts`).
    expect(inaktiv).toHaveStyle({ color: rahmenFarben.gedaempft });
  });

  it('setzt „Einstellungen" abgesetzt an den Fuß — sechs Ziele bleiben in EINER Landmarke', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Kategorien' });
    expect(nav.querySelectorAll('button')).toHaveLength(6);
    const fuss = nav.querySelector('[data-lfh="rail-fuss"]')!;
    expect(fuss).not.toBeNull();
    expect(fuss.querySelectorAll('button')).toHaveLength(1);
    expect(fuss.querySelector('button')).toHaveAttribute('aria-label', 'Einstellungen');
  });

  /**
   * LLH-1734: Steht über der Rail etwas im Fluss (ab `md` die Betriebszeile mit dem Offline-Hinweis),
   * misst die Rail diesen Vorlauf und zieht ihn von der Spaltenhöhe ab; sonst lag der Fuß um seine
   * Höhe unter dem Fensterrand. jsdom rechnet kein Layout, deshalb die gestellte Lage der `<nav>`.
   */
  it('misst den Vorlauf über der Rail und legt ihn als Variable an die Landmarke', () => {
    const echt = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('aria-label') === 'Kategorien') return new DOMRect(0, 37, 60, 700);
      return echt.call(this);
    });
    try {
      renderMitProviders(
        <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
      );
      const nav = screen.getByRole('navigation', { name: 'Kategorien' });
      expect(nav.style.getPropertyValue('--lfh-rail-vorlauf')).toBe('37px');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('Kategorien und Fuß kleben als eine Spalte unter dem Rahmen (LFH-952)', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Kategorien' });
    // EINE klebende Spalte, nicht zwei klebende Teile: die überlappten bei geringer Höhe.
    const spalte = nav.querySelector<HTMLElement>('[data-lfh="rail-spalte"]')!;
    expect(spalte.style.position).toBe('sticky');
    expect(spalte.style.top).toBe('var(--lfh-kopf-oben, 0px)');
    // Abzüglich des Vorlaufs: was im Fluss über der Rail steht (LLH-1734).
    expect(spalte.style.height).toBe(
      'calc(100dvh - var(--lfh-kopf-oben, 0px) - var(--lfh-rail-vorlauf, 0px))',
    );
    expect(spalte.style.overflowY).toBe('auto');
    const haupt = spalte.querySelector<HTMLElement>('[data-lfh="rail-haupt"]')!;
    expect(haupt.style.position).toBe('');
    // Der Fuß klebt nicht in der Spalte (LLH-1273): reicht die Höhe nicht, folgt er den
    // Kategorien, statt über ihnen zu liegen. Ans Ende schiebt ihn `marginTop: auto`.
    const fuss = spalte.querySelector<HTMLElement>('[data-lfh="rail-fuss"]')!;
    expect(fuss).not.toBeNull();
    expect(fuss.style.position).toBe('');
    expect(fuss.style.marginTop).toBe('auto');
    // Fünf Kategorien in der Gruppe, „Einstellungen“ nicht: es steht im Fuß.
    expect(haupt.querySelectorAll('button')).toHaveLength(5);
    expect(haupt.querySelector('[aria-label="Einstellungen"]')).toBeNull();
  });

  it('meldet Klick mit dem Kategorie-Key', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={onKlick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Betroffene & Schäden' }));
    expect(onKlick).toHaveBeenCalledWith('erfassung');
  });

  it('zeigt jedes Kurzetikett als sichtbaren Text — ohne Hover', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    // `getByText`, NICHT `getByRole(name:)`: der Name käme auch aus `aria-label`. Die Aussage ist,
    // dass ein Text SICHTBAR im Baum steht — auf dem Tablet gibt es kein Hover. Sichtbar steht das
    // Kurzetikett, der volle Name bleibt `aria-label` und `title`.
    for (const k of kategorien) {
      expect(screen.getByText(k.kurz)).toBeVisible();
      if (k.kurz !== k.label) {
        expect(screen.getByRole('button', { name: k.label })).toHaveAttribute('title', k.label);
      }
    }
  });
});

/**
 * Die Zielhöhe OHNE zu rendern: `test/utils.tsx` montiert ein nacktes `ConfigProvider`,
 * `useToken()` liefert dort den antd-Seed statt der Staffel. Bauform wie `ModulPanel.test.tsx`.
 *
 * Die Böden stehen als LITERALE da, sonst prüfte der Test den Token gegen sich selbst.
 */
describe('IconRail · Dichte', () => {
  const tokenFuer = (s: keyof typeof dichten) => ({
    controlHeight: dichten[s].zeilenhoehe,
    paddingXS: dichten[s].abstand.xs,
    marginXS: dichten[s].abstand.xs,
  });
  const hoehe = (s: keyof typeof dichten) => railZielStil(tokenFuer(s), { aktiv: false }).minHeight;

  it('hält die Entwurfshöhe 62 als Boden — über dem A1-Boden von 48 px', () => {
    // `Math.max`, nicht `??`: mit `??` stände in der kompakten Stufe 30 — unter dem Boden der Rail.
    expect(hoehe('kompakt')).toBe(62);
    expect(hoehe('komfortabel')).toBe(62);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('wächst mit der Staffel, statt auf dem Boden zu kleben', () => {
    expect(hoehe('kompakt')).toBeLessThan(hoehe('handschuh') as number);
  });

  it('trägt ZWEI Angaben, nicht eine (LFH-365)', () => {
    // Konkreter Wert als LITERAL: `paddingXS` der Stufe (8) senkrecht, waagerecht 2 px —
    // die 60-px-Rail hat für eine mitwachsende Seitenpolsterung keinen Platz.
    const stil = railZielStil(tokenFuer('handschuh'), { aktiv: false });
    expect(stil.minHeight).toBe(72);
    expect(stil.padding).toBe('8px 2px');
  });
});

/**
 * LFH-952 (D5): am Tablet quer ist das Modulmenü ohne Wahl zu. Der Griff „Menü“ im Fuß ist der
 * sichtbare Weg zurück; der Selbstklick auf die offene Kategorie bleibt der zweite.
 */
describe('IconRail · Griff des Modulmenüs (LFH-952)', () => {
  function rail(offen: boolean, onUmschalten = () => {}) {
    return renderMitProviders(
      <IconRail
        kategorien={kategorien}
        aktiveKategorie="erfassung"
        onKategorieKlick={() => {}}
        panel={{ offen, onUmschalten }}
      />,
    );
  }

  it('steht im Fuß über „Einstellungen“, mit sichtbarem Etikett „Menü“', () => {
    rail(true);
    const fuss = document.querySelector<HTMLElement>('[data-lfh="rail-fuss"]')!;
    const knoepfe = fuss.querySelectorAll('button');
    expect(knoepfe).toHaveLength(2);
    expect(knoepfe[0]).toHaveAccessibleName('Menü einklappen');
    expect(knoepfe[0]).toHaveTextContent('Menü');
    expect(knoepfe[1]).toHaveAttribute('aria-label', 'Einstellungen');
  });

  it('offen: aria-expanded true und aria-controls auf das Panel', () => {
    rail(true);
    const griff = screen.getByRole('button', { name: 'Menü einklappen' });
    expect(griff).toHaveAttribute('aria-expanded', 'true');
    expect(griff).toHaveAttribute('aria-controls', 'modul-panel');
  });

  it('zu: heißt „ausklappen“, aria-expanded false', () => {
    rail(false);
    const griff = screen.getByRole('button', { name: 'Menü ausklappen' });
    expect(griff).toHaveAttribute('aria-expanded', 'false');
  });

  it('meldet den Klick', async () => {
    const onUmschalten = vi.fn();
    rail(false, onUmschalten);
    await userEvent.click(screen.getByRole('button', { name: 'Menü ausklappen' }));
    expect(onUmschalten).toHaveBeenCalledTimes(1);
  });

  it('die offene Kategorie trägt aria-expanded, die anderen nicht', () => {
    rail(false);
    expect(screen.getByRole('button', { name: 'Betroffene & Schäden' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Lage' })).not.toHaveAttribute('aria-expanded');
  });

  it('ohne `panel` (kein Panel neben der Rail) gibt es keinen Griff', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie="erfassung" onKategorieKlick={() => {}} />,
    );
    expect(
      screen.queryByRole('button', { name: /^Menü (ein|aus)klappen$/ }),
    ).not.toBeInTheDocument();
  });
});

/**
 * LLH-1732: eine Kategorie mit Ziel ist ein Link auf ihr erstes freigegebenes Modul, damit
 * Strg/⌘+Klick und Mittelklick einen neuen Tab öffnen. Der einfache Klick bleibt beim Rahmen
 * (Sprung oder Umklappen); `fireEvent`, weil nur dessen Rückgabe `preventDefault` zeigt.
 */
describe('IconRail · Kategorien als Links (LLH-1732)', () => {
  const pfade: Partial<Record<string, string>> = {
    fuehrung: '/einsaetze/7/ueberblick',
    erfassung: '/einsaetze/7/personen',
  };
  function rail(onKategorieKlick = vi.fn()) {
    renderMitProviders(
      <IconRail
        kategorien={kategorien}
        aktiveKategorie="erfassung"
        onKategorieKlick={onKategorieKlick}
        kategoriePfad={(key) => pfade[key] ?? null}
        panel={{ offen: true, onUmschalten: () => {} }}
      />,
    );
    return onKategorieKlick;
  }

  it('führt eine Kategorie mit Ziel als Link, ohne Ziel bleibt sie Knopf', () => {
    rail();
    expect(screen.getByRole('link', { name: 'Führung' })).toHaveAttribute(
      'href',
      '/einsaetze/7/ueberblick',
    );
    // Ohne freigegebenes Modul gibt es keine Adresse: der Klick klappt nur auf.
    expect(screen.getByRole('button', { name: 'Lage' })).not.toHaveAttribute('href');
    expect(screen.queryByRole('link', { name: 'Lage' })).not.toBeInTheDocument();
  });

  it('behält an der offenen Kategorie aria-current, aria-expanded und aria-controls', () => {
    rail();
    const erfassung = screen.getByRole('link', { name: 'Betroffene & Schäden' });
    expect(erfassung).toHaveAttribute('aria-current', 'true');
    expect(erfassung).toHaveAttribute('aria-expanded', 'true');
    expect(erfassung).toHaveAttribute('aria-controls', 'modul-panel');
  });

  it('übernimmt den einfachen Klick, Strg/⌘/Umschalt bleiben beim Browser', () => {
    const onKategorieKlick = rail();
    const fuehrung = screen.getByRole('link', { name: 'Führung' });
    for (const taste of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(fireEvent.click(fuehrung, taste), JSON.stringify(taste)).toBe(true);
    }
    expect(onKategorieKlick).not.toHaveBeenCalled();
    expect(fireEvent.click(fuehrung)).toBe(false);
    expect(onKategorieKlick).toHaveBeenCalledWith('fuehrung');
  });

  it('hält die sechs Ziele in einer Landmarke, Links und Knöpfe zusammen', () => {
    rail();
    const nav = screen.getByRole('navigation', { name: 'Kategorien' });
    // Sechs Kategorien plus der Griff „Menü“.
    expect(nav.querySelectorAll('a, button')).toHaveLength(7);
    expect(nav.querySelectorAll('a')).toHaveLength(2);
  });
});
