import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { Input } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { dichten, farbenHell } from '../../theme/tokens';
import Schnellerfassungszeile, {
  schnellerfassungStil,
  zellenStile,
} from './Schnellerfassungszeile';

describe('Schnellerfassungszeile', () => {
  it('ist nur Hülle: kein eigenes Formular, das Feld des Aufrufers steht darin', () => {
    const { container } = renderMitProviders(
      <Schnellerfassungszeile
        praefix="/anordnung"
        hinweis="↵ eintragen"
        hinweiszeile="/meldung · /lage"
      >
        <Input aria-label="Eintrag" />
      </Schnellerfassungszeile>,
    );
    // Ein <form> hier wäre ein verschachteltes Formular im Formular des Konsumenten.
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Eintrag' })).toBeInTheDocument();
    expect(screen.getByText('/anordnung')).toHaveStyle({ color: farbenHell.bedien });
    expect(screen.getByText('↵ eintragen')).toBeInTheDocument();
    expect(screen.getByText('/meldung · /lage')).toBeInTheDocument();
  });

  it('Rahmen bedien, Grund flaeche2, Höhe mindestens 40 und nie unter der Staffel', () => {
    const stil = (s: keyof typeof dichten) =>
      schnellerfassungStil(farbenHell, { controlHeight: dichten[s].zeilenhoehe });
    expect(stil('kompakt')).toMatchObject({
      border: `1px solid ${farbenHell.bedien}`,
      background: farbenHell.flaeche2,
      minHeight: 40,
    });
    expect(stil('komfortabel').minHeight).toBe(50);
    expect(stil('handschuh').minHeight).toBe(74);
  });

  it('ohne Präfix keine Präfix-Zelle', () => {
    const { container } = renderMitProviders(
      <Schnellerfassungszeile>
        <Input aria-label="Eintrag" />
      </Schnellerfassungszeile>,
    );
    expect(container.querySelector('[data-lfh="schnellerfassung-praefix"]')).toBeNull();
  });

  /**
   * LFH-373, opt-in `gestapelt`: auf schmalem Schirm steht das Feld auf eigener, voller Zeile,
   * Präfix und Hinweis folgen darunter. Ohne die Eigenschaft bleibt die Zeile einzeilig — die
   * Personenseite nutzt dieselbe Hülle.
   */
  it('gestapelt: Feld zuerst und volle Breite, Hinweis rechts in der zweiten Zeile', () => {
    const t = { controlHeight: 30, paddingSM: 12 };
    const zeile = schnellerfassungStil(farbenHell, t, true);
    const z = zellenStile(farbenHell, t, true);
    expect(zeile.flexWrap).toBe('wrap');
    expect(z.feld).toMatchObject({ flex: '1 1 100%' });
    // Kein CSS-`order`: die sichtbare Folge kommt aus dem DOM, sonst wichen Tab- und Lesefolge von
    // ihr ab.
    expect(z.feld.order).toBeUndefined();
    expect(z.hinweis.marginInlineStart).toBe('auto');
    expect(z.praefix.borderInlineEnd).toBeUndefined();
  });

  it('ungestapelt: unverändert eine Zeile mit Trennlinie hinter dem Präfix', () => {
    const t = { controlHeight: 30, paddingSM: 12 };
    const zeile = schnellerfassungStil(farbenHell, t);
    const z = zellenStile(farbenHell, t, false);
    expect(zeile.flexWrap).toBeUndefined();
    expect(z.feld).toMatchObject({ flex: '1 1 auto' });
    expect(z.feld.order).toBeUndefined();
    expect(z.praefix.borderInlineEnd).toBe(`1px solid ${farbenHell.linie}`);
  });

  it('gestapelt: das Feld steht im DOM VOR Präfix und Hinweis — Tab- und Lesefolge = Sichtfolge', () => {
    const { container } = renderMitProviders(
      <Schnellerfassungszeile gestapelt praefix="/meldung" hinweis="Erfassen">
        <Input aria-label="Eintrag" />
      </Schnellerfassungszeile>,
    );
    const zeile = container.querySelector('.lfh-schnellerfassung')!;
    const kinder = Array.from(zeile.children);
    expect(kinder[0].classList.contains('lfh-schnellerfassung__feld')).toBe(true);
    expect(kinder[1].getAttribute('data-lfh')).toBe('schnellerfassung-praefix');
  });

  /**
   * LFH-955 (design.md D2): ungestapelt blieb das Kind der Feldzelle auf seiner Inhaltsbreite —
   * im ETB rund 160 px bei 870 px Zeile. Das Strecken ist ein Opt-in, keine Regel der Hülle:
   * eine Zelle mit mehreren Feldern nebeneinander bekäme sonst gestreckte Kinder.
   */
  it('feldFuellt: nur dann trägt die Feldzelle die Klasse, die ihr Kind streckt', () => {
    const { unmount } = renderMitProviders(
      <Schnellerfassungszeile feldFuellt>
        <Input aria-label="Feld" />
      </Schnellerfassungszeile>,
    );
    const zelle = () => screen.getByLabelText('Feld').closest('.lfh-schnellerfassung__feld');
    expect(zelle()).toHaveClass('lfh-schnellerfassung__feld--fuellt');
    unmount();
    renderMitProviders(
      <Schnellerfassungszeile>
        <Input aria-label="Feld" />
      </Schnellerfassungszeile>,
    );
    expect(zelle()).not.toHaveClass('lfh-schnellerfassung__feld--fuellt');
  });

  it('feldFuellt: die Regel in sprache.css streckt das direkte Kind', () => {
    const css = readFileSync(join(process.cwd(), 'src/theme/sprache.css'), 'utf8');
    const regel = css.match(/([^{}]*)\{\s*flex: 1 1 auto;\s*min-width: 0;\s*\}/);
    expect(regel?.[1]).toContain('.lfh-schnellerfassung__feld--fuellt > *');
  });
});
