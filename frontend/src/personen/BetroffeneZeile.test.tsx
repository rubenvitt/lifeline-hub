import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSON_NAME_MAX } from '../api/eingabegrenzen';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';
import BetroffeneZeile from './BetroffeneZeile';

/**
 * Die Kürzel-Legende der Erfassungszeile (LLH-1767; davor LFH-963/LFH-1078): ein Raster aus
 * Zeichen und ausgeschriebener Bedeutung in Lauftextgröße statt einer Mono-11-Fließzeile. Ab `md`
 * liegt sie, solange das LEERE Feld den Fokus hat, als Schicht unter der Zeile (sie schiebt die
 * Liste nicht); sonst ist sie nur für Vorlesende da, als Beschreibung des Felds. Unter `md` klappt
 * sie hinter „Kürzel anzeigen“ ein und steht aufgeklappt im Fluss. Die Breiten als Literale (390
 * Handschirm, 1180 Tablet quer).
 */

afterEach(() => setzeViewportZurueck());

function zeige(onErfassen = vi.fn()) {
  const { container } = renderMitProviders(
    <BetroffeneZeile uhsListe={[]} onErfassen={onErfassen} />,
  );
  return {
    onErfassen,
    container,
    feld: screen.getByRole('textbox', { name: 'Kurzeingabe Person' }),
  };
}

const legende = () => document.querySelector<HTMLElement>('[data-lfh="kuerzel"]')!;

describe('BetroffeneZeile — Kürzel-Legende (LLH-1767)', () => {
  it('liegt ab md nur bei Fokus auf dem leeren Feld als Schicht unter der Zeile', async () => {
    setzeViewportBreite(1180);
    const { feld } = zeige();
    // Ohne Fokus aus dem Bild, aber weiter die Beschreibung des Felds.
    expect(legende()).toHaveStyle({ position: 'absolute', width: '1px' });
    expect(feld).toHaveAccessibleDescription(expect.stringContaining('Sichtung'));
    await userEvent.click(feld);
    // Als Schicht: absolut unter der Zeile, in Lauftextgröße, nicht im Fluss.
    expect(legende()).toHaveStyle({ position: 'absolute', top: '100%', fontSize: '14px' });
    expect(legende()).not.toHaveStyle({ width: '1px' });
    await userEvent.type(feld, 'M');
    expect(legende()).toHaveStyle({ width: '1px' });
    await userEvent.clear(feld);
    await userEvent.tab();
    expect(legende()).toHaveStyle({ width: '1px' });
    expect(screen.queryByRole('button', { name: 'Kürzel anzeigen' })).not.toBeInTheDocument();
  });

  it('schreibt jedes Zeichen mit seiner Bedeutung aus, die Farben aus der Quelle des Parsers', async () => {
    setzeViewportBreite(1180);
    const { feld } = zeige();
    await userEvent.click(feld);
    const zeilen = Array.from(legende().querySelectorAll('dt')).map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(zeilen.map(([z]) => z)).toEqual([
      'Name, Vorname',
      'm / w / d',
      'rot · gelb · grün · blau',
      '!',
      '+',
      '>entl',
      '#',
      '@',
    ]);
    const bedeutung = Object.fromEntries(zeilen);
    expect(bedeutung['rot · gelb · grün · blau']).toMatch(/^Sichtung SK I–IV · auch sk1–sk4/);
    expect(bedeutung['rot · gelb · grün · blau']).toContain('skt = tot · sku = unverletzt');
    expect(bedeutung['m / w / d']).toContain('m ca 50');
    expect(bedeutung['!']).toMatch(/^Anlass: verl · /);
    expect(bedeutung['@']).toMatch(/^Unfallhilfsstelle/);
    expect(bedeutung['#']).toContain('52.2691/9.1342');
  });

  it('klappt unter md ein und auf Wunsch im Fluss wieder auf — derselbe Knopf, der Fokus bleibt', async () => {
    setzeViewportBreite(390);
    const { feld } = zeige();
    expect(legende()).toHaveStyle({ position: 'absolute', width: '1px' });
    expect(feld).toHaveAccessibleDescription(expect.stringContaining('Sichtung'));
    const knopf = screen.getByRole('button', { name: 'Kürzel anzeigen' });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(knopf);
    expect(legende()).not.toHaveStyle({ position: 'absolute' });
    expect(knopf).toHaveAccessibleName('Kürzel ausblenden');
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(knopf).toHaveFocus();
    expect(feld).not.toHaveAccessibleDescription(expect.stringContaining('Kürzel ausblenden'));
    await userEvent.click(knopf);
    expect(legende()).toHaveStyle({ position: 'absolute', width: '1px' });
  });
});

describe('BetroffeneZeile — stille Fehlwege (LLH-1767)', () => {
  it('nennt bei Enter auf dem leeren Feld leise „Noch nichts eingegeben“ und sendet nicht', async () => {
    const { feld, onErfassen } = zeige();
    await userEvent.type(feld, '{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('Noch nichts eingegeben');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
    await userEvent.type(feld, 'M');
    expect(screen.queryByText('Noch nichts eingegeben')).not.toBeInTheDocument();
  });

  it('markiert ein nicht verstandenes Wort in „erkannt:“ und sendet nicht', async () => {
    const { feld, onErfassen } = zeige();
    await userEvent.type(feld, 'Mann ca 40 rot verwirrt');
    const erkannt = document.querySelector('[data-lfh="erkannt"]')!;
    expect(erkannt).toHaveTextContent('Mann');
    expect(erkannt.querySelector('[data-sichtung="sk1"]')).not.toBeNull();
    const marke = screen.getByTitle('Nicht verstanden');
    expect(marke).toHaveTextContent('verwirrt ?');
    await userEvent.type(feld, '{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nicht erfasst: „verwirrt" nicht verstanden',
    );
    expect(onErfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Mann ca 40 rot verwirrt');
  });
});

/**
 * Feld in voller Breite am Handy (LLH-1762): unter `md` ließen Präfix „/person“ und Knopf (140 px)
 * dem Feld 96 px, etwa elf Zeichen. Gestapelt steht das Feld allein in der ersten Zeile der Box,
 * „/person“ und „Person erfassen“ darunter; ab `md` bleibt alles in einer Zeile.
 */
describe('BetroffeneZeile — Breite des Felds (LLH-1762)', () => {
  const zelleVon = (el: HTMLElement) => el.closest('.lfh-schnellerfassung__feld');

  it('unter md steht das Feld allein in seiner Zelle, Präfix und Knopf darunter', () => {
    setzeViewportBreite(390);
    const { container } = zeige();
    const feld = screen.getByRole('textbox', { name: 'Kurzeingabe Person' });
    const knopf = screen.getByRole('button', { name: 'Person erfassen' });
    expect(zelleVon(feld)).toHaveClass('lfh-schnellerfassung__feld--gestapelt');
    expect(zelleVon(knopf)).toBeNull();
    // DOM-Folge = Sichtfolge = Tab-Folge: Feld, Präfix, Knopf.
    const zeile = container.querySelector('.lfh-schnellerfassung')!;
    expect(zeile.firstElementChild).toBe(zelleVon(feld));
    expect(zeile.lastElementChild).toContainElement(knopf);
  });

  it('ab md bleibt die Zeile einzeilig mit dem Knopf neben dem Feld', () => {
    setzeViewportBreite(1180);
    zeige();
    const feld = screen.getByRole('textbox', { name: 'Kurzeingabe Person' });
    const knopf = screen.getByRole('button', { name: 'Person erfassen' });
    expect(zelleVon(feld)).not.toHaveClass('lfh-schnellerfassung__feld--gestapelt');
    expect(zelleVon(knopf)).toBe(zelleVon(feld));
  });
});

/**
 * Grenze des Namens in der Schnellerfassung (LLH-1329): ab 80 % steht der Zähler an der Marke,
 * darüber sendet die Zeile nicht, nennt den Grund und behält den Wortlaut. Mutationsprobe: den
 * Zähler an der Namensmarke entfernt → „201 / 200 · zu lang“ fehlt und der Fall wird rot.
 */
describe('BetroffeneZeile — Grenze des Namens (LLH-1329)', () => {
  it('zählt ab 80 %, sperrt über der Grenze und kürzt nicht', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<BetroffeneZeile uhsListe={[]} onErfassen={onErfassen} />);
    const feld = screen.getByRole('textbox', { name: 'Kurzeingabe Person' });

    fireEvent.change(feld, { target: { value: 'x'.repeat(PERSON_NAME_MAX * 0.8 - 1) } });
    expect(screen.queryByText(/ \/ 200/)).toBeNull();

    const lang = 'x'.repeat(PERSON_NAME_MAX + 1);
    fireEvent.change(feld, { target: { value: `${lang} sk2` } });
    expect(screen.getByText('201 / 200 · zu lang')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Person erfassen' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nicht erfasst: Name darf höchstens 200 Zeichen lang sein',
    );
    expect(onErfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue(`${lang} sk2`);
  });
});
