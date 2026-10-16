import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import KraeftebaumZelle, { gruppenText } from './KraeftebaumZelle';
import { besatzungText, besatzungZeilen, fremdText } from './kraeftebaumKern';
import { baueMeldebildRaster, type RasterZeile } from './meldebildRaster';
import { schrift } from '../theme/tokens';
import type { Einheit, EinsatzFahrzeug, EinsatzMaterial, EinsatzPersonal } from '../api/types';

const EINHEIT = {
  id: 1,
  einsatz_id: 1,
  abschnitt_id: null,
  ueber_einheit_id: null,
  name: 'Zug 1',
  typ_label: 'Zug',
  fuehrer_id: 2,
  fahrzeug_mitglieder: [],
  tz_fachaufgabe: null,
  tz_organisation: null,
} as unknown as Einheit;
const GRUPPE = { ...EINHEIT, id: 3, name: 'Gr 2', fuehrer_id: null, typ_label: 'Gruppe' };
const FAHRZEUG = {
  id: 30,
  einsatz_id: 1,
  einheit_id: 1,
  funkrufname: 'Florian 1-44-1',
  fahrzeugtyp: 'HLF 20',
  soll_besatzung: { fuehrer: 1, unterfuehrer: 1, mannschaft: 7 },
} as EinsatzFahrzeug;
const person = (
  id: number,
  einheit_id: number,
  pos: EinsatzPersonal['staerke_position'],
  fahrzeug_id: number | null,
) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id,
    fahrzeug_id,
    name: `Person ${id}`,
    funktion: id === 2 ? 'Zugführer' : null,
    staerke_position: pos,
    status_kategorie: 'gebunden',
  }) as EinsatzPersonal;
const MATERIAL = [
  {
    id: 1,
    einheit_id: 1,
    bezeichnung: 'Pumpe',
    menge: 1,
    status: 'defekt',
    art: 'geraet',
    ausgegeben: 0,
  },
  {
    id: 2,
    einheit_id: 1,
    bezeichnung: 'Sauger',
    menge: 1,
    status: 'einsatzbereit',
    art: 'geraet',
    ausgegeben: 0,
  },
] as EinsatzMaterial[];

/** Zug mit Fahrzeug (EF und eine Person aus Gr 2 darauf), einer Person ohne Fahrzeug, Material. */
function baum(): RasterZeile[] {
  return baueMeldebildRaster({
    abschnitte: [],
    einheiten: [EINHEIT, GRUPPE],
    personal: [
      person(2, 1, 'fuehrer', 30),
      person(4, 1, null, null),
      person(5, 3, 'mannschaft', 30),
    ],
    fahrzeuge: [FAHRZEUG],
    material: MATERIAL,
    statusKatalog: [],
    auftraege: [],
  });
}
const alle = (z: readonly RasterZeile[]): RasterZeile[] =>
  z.flatMap((x) => [x, ...alle(x.children ?? [])]);
const finde = (key: string) => alle(baum()).find((z) => z.key === key)!;

const offen = () => false;

function zeige(key: string, gesperrt: (m: string) => boolean = offen) {
  return renderMitProviders(
    <KraeftebaumZelle zeile={finde(key)} einsatzId={7} gesperrt={gesperrt} />,
  );
}

describe('KraeftebaumZelle', () => {
  it('jede Zeilenart trägt ihre Art, ihr Zeichen und ihre Schrift', () => {
    const arten: [string, string, string][] = [
      ['eh-1', 'einheit', '[data-lfh="einheit-zeichen"]'],
      ['ef-30', 'fahrzeug', '[data-lfh="fahrzeug-zeichen"]'],
      ['ep-2', 'person', '[data-lfh="kraeftebaum-marke"]'],
      ['ofz-1', 'ohne-fahrzeug', '.lfh-augenbraue'],
      ['mtl-1', 'material-gruppe', '.lfh-augenbraue'],
    ];
    for (const [key, art, zeichen] of arten) {
      const { container, unmount } = zeige(key);
      const zelle = container.querySelector('[data-lfh="kraeftebaum-zelle"]');
      expect(zelle, key).toHaveAttribute('data-art', art);
      expect(zelle!.querySelector(zeichen), `${key}: Zeichen`).not.toBeNull();
      unmount();
    }
  });

  it('Einheitenname, Funkrufname und Personenname springen in ihr Modul', () => {
    zeige('eh-1');
    expect(screen.getByRole('link', { name: 'Zug 1' })).toHaveAttribute(
      'href',
      '/einsaetze/7/einheiten/1',
    );
    zeige('ef-30');
    expect(screen.getByRole('link', { name: 'Florian 1-44-1' })).toHaveAttribute(
      'href',
      '/einsaetze/7/fahrzeuge?fahrzeug=30',
    );
    zeige('ep-2');
    expect(screen.getByRole('link', { name: 'Person 2' })).toHaveAttribute(
      'href',
      '/einsaetze/7/personal?personal=2',
    );
  });

  it('ohne Leserecht auf das Zielmodul steht der Name als Text', () => {
    zeige('ep-2', (m) => m === 'personal');
    expect(screen.getByText('Person 2')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('Personen tragen Positionsmarke und „EF“; ohne Position „–“, kein erfundenes „M“', () => {
    const { container } = zeige('ep-2');
    expect(
      [...container.querySelectorAll('[data-lfh="kraeftebaum-marke"]')].map((m) => m.textContent),
    ).toEqual(['F', 'EF']);
    expect(screen.getByText(/Zugführer/)).toBeInTheDocument();
    const { container: ohne } = zeige('ep-4');
    expect(
      [...ohne.querySelectorAll('[data-lfh="kraeftebaum-marke"]')].map((m) => m.textContent),
    ).toEqual(['–']);
  });

  it('eine Person auf dem Fahrzeug einer anderen Einheit „fährt auf“ es', () => {
    zeige('ep-5');
    expect(screen.getByText('fährt auf Florian 1-44-1')).toBeInTheDocument();
  });

  it('das Fahrzeug nennt die fremden Kräfte seiner Besatzung', () => {
    zeige('ef-30');
    expect(screen.getByText('HLF 20 · davon 1 aus Gr 2')).toBeInTheDocument();
  });

  it('die Materialgruppe nennt Posten und Ausfall', () => {
    zeige('mtl-1');
    expect(screen.getByText('Material')).toBeInTheDocument();
    expect(screen.getByText('· 2 Posten')).toBeInTheDocument();
    expect(screen.getByText('· 1 Ausfall')).toBeInTheDocument();
    // Zahlen immer Mono: Anzahl und Ausfall in der Zahlenschrift.
    const mono = document.createElement('span');
    mono.style.fontFamily = schrift.zahl;
    for (const text of ['· 2 Posten', '· 1 Ausfall']) {
      expect(screen.getByText(text).style.fontFamily, text).toBe(mono.style.fontFamily);
    }
  });
});

describe('KraeftebaumZelle — „nicht übernommen“ (LLH-1075)', () => {
  const zeile = (nichtUebernommen: boolean) =>
    ({
      art: 'einheit',
      einheitId: 1,
      bezeichnung: 'Florian Nachbar 3',
      zusatz: null,
      tz: { typLabel: null, fachaufgabe: null, organisation: null },
      nichtUebernommen,
    }) as const;

  it('zeigt das Kennzeichen an der Einheit mit offener Übernahme', () => {
    renderMitProviders(<KraeftebaumZelle zeile={zeile(true)} einsatzId={7} gesperrt={offen} />);
    expect(screen.getByText('nicht übernommen')).toBeInTheDocument();
  });

  it('eine übernommene Einheit trägt keins', () => {
    renderMitProviders(<KraeftebaumZelle zeile={zeile(false)} einsatzId={7} gesperrt={offen} />);
    expect(screen.queryByText('nicht übernommen')).toBeNull();
    zeige('eh-1');
    expect(screen.queryByText('nicht übernommen')).toBeNull();
  });
});

describe('Texte des Kräftebaums', () => {
  it('Besatzung Ist/Soll statt Stärke, „nicht erfasst“ ohne Kraft', () => {
    const b = finde('ef-30').besatzung!;
    expect(besatzungText(b)).toBe('Ist 1/0/1//2 · Soll 1/1/7//9');
    // Die Stärkespalte setzt dieselben Teile untereinander.
    expect(besatzungZeilen(b)).toEqual(['Ist 1/0/1//2', 'Soll 1/1/7//9']);
    expect(besatzungText({ ...b, soll: null })).toBe('Ist 1/0/1//2');
    expect(besatzungText({ ...b, urteil: 'nicht_erfasst' })).toBe('Besatzung nicht erfasst');
    expect(fremdText({ ...b, fremd: [] })).toBeNull();
    expect(fremdText({ ...b, fremd: [{ einheit: 'ohne Einheit', anzahl: 2 }] })).toBe(
      'davon 2 ohne Einheit',
    );
  });

  it('Gruppentexte: Ausfall nur, wenn es einen gibt', () => {
    expect(gruppenText({ art: 'material-gruppe', gruppe: { anzahl: 3, ausfall: 0 } })).toEqual([
      '3 Posten',
    ]);
    expect(gruppenText({ art: 'ohne-fahrzeug', gruppe: { anzahl: 1, ausfall: 0 } })).toEqual([
      '1 Kraft',
    ]);
  });
});
