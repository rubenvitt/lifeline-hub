import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Markdown from './Markdown';

describe('Markdown', () => {
  it('rendert eine Überschrift als heading-Element', () => {
    render(<Markdown unterEbene={3}>{'# Lageüberblick'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Lageüberblick' })).toBeInTheDocument();
  });

  /*
   * Die Ebene nennt der EINBAUORT (LFH-621): `unterEbene` ist die Ebene der nächsten Überschrift
   * über dem Text, `#` wird die Ebene darunter. Ein fester Versatz ließe `###` und tiefer ohne Not
   * auf `h6` zusammenfallen.
   */
  it('setzt `#` eine Ebene unter die Überschrift des Einbauorts — nie ein zweites h1', () => {
    render(
      <Markdown unterEbene={2}>
        {'# Eins\n\n## Zwei\n\n### Drei\n\n#### Vier\n\n##### Fünf'}
      </Markdown>,
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Eins' })).toHaveClass('md-h1');
    expect(screen.getByRole('heading', { level: 4, name: 'Zwei' })).toHaveClass('md-h2');
    expect(screen.getByRole('heading', { level: 5, name: 'Drei' })).toHaveClass('md-h3');
    expect(screen.getByRole('heading', { level: 6, name: 'Vier' })).toHaveClass('md-h4');
    // Erst hinter der sechsten Stufe ist h6 der Boden; die Optik unterscheidet die Klasse.
    expect(screen.getByRole('heading', { level: 6, name: 'Fünf' })).toHaveClass('md-h5');
  });

  it('folgt dem Einbauort: unter einem Abschnittskopf (h3) beginnt der Text bei h4', () => {
    render(<Markdown unterEbene={3}>{'# Eins\n\n## Zwei\n\n### Drei'}</Markdown>);
    expect(screen.getByRole('heading', { level: 4, name: 'Eins' })).toHaveClass('md-h1');
    expect(screen.getByRole('heading', { level: 5, name: 'Zwei' })).toHaveClass('md-h2');
    expect(screen.getByRole('heading', { level: 6, name: 'Drei' })).toHaveClass('md-h3');
  });

  it('direkt unter dem Seitentitel beginnt der Text bei h2', () => {
    render(<Markdown unterEbene={1}>{'# Eins'}</Markdown>);
    expect(screen.getByRole('heading', { level: 2, name: 'Eins' })).toHaveClass('md-h1');
  });

  it('rendert eine Liste als list items', () => {
    render(<Markdown unterEbene={3}>{'- Punkt A\n- Punkt B'}</Markdown>);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Punkt A');
  });

  it('rendert Fettung als <strong>', () => {
    const { container } = render(<Markdown unterEbene={3}>{'Lage ist **kritisch**'}</Markdown>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent('kritisch');
  });

  it('rendert GFM-Durchstreichung (remark-gfm aktiv)', () => {
    const { container } = render(<Markdown unterEbene={3}>{'~~veraltet~~'}</Markdown>);
    expect(container.querySelector('del')).toHaveTextContent('veraltet');
  });

  // --- XSS / Akzeptanzkriterium „kein ungefiltertes HTML" ---

  it('rendert rohes HTML NICHT als Markup, sondern als Text', () => {
    const { container } = render(
      <Markdown unterEbene={3}>{'<script>alert(1)</script>Hallo'}</Markdown>,
    );
    // Kein <script>-Element darf in den DOM gelangen.
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('alert(1)');
  });

  it('rendert <img onerror=…> nicht als HTML-Element', () => {
    const { container } = render(
      <Markdown unterEbene={3}>{'<img src=x onerror="alert(1)">'}</Markdown>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('sanitisiert javascript:-Links (kein gefährliches href)', () => {
    const { container } = render(
      <Markdown unterEbene={3}>{'[klick](javascript:alert(1))'}</Markdown>,
    );
    const link = container.querySelector('a');
    // react-markdown defused unsichere Schemata per Default — href darf kein javascript: sein.
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
  });

  // --- Varianten für die zwei Einsatzkontexte ---

  it('trägt die kompakt-Variante als CSS-Klasse (für ETB-Tabellenzellen)', () => {
    const { container } = render(
      <Markdown variante="kompakt" unterEbene={3}>
        {'Text'}
      </Markdown>,
    );
    expect(container.querySelector('.markdown--kompakt')).not.toBeNull();
  });

  it('nutzt die dokument-Variante als Default (für Lagebericht)', () => {
    const { container } = render(<Markdown unterEbene={3}>{'Text'}</Markdown>);
    expect(container.querySelector('.markdown--dokument')).not.toBeNull();
  });

  /*
   * LFH-1008: Firefox setzt `break-after: avoid` nicht um; Titel und erster Block teilen sich
   * deshalb eine Hülle, die `druck/druck.css` nicht brechen lässt.
   */
  it('fasst eine Überschrift im Text mit dem ersten Absatz in einen Titelblock', () => {
    const { container } = render(
      <Markdown unterEbene={3}>{'## Eigene Lage\n\nErster Absatz\n\nZweiter Absatz'}</Markdown>,
    );
    const block = container.querySelector('[data-lfh="titelblock"]');
    expect(block, 'kein Titelblock').not.toBeNull();
    expect(block!.querySelector('h5')).toHaveTextContent('Eigene Lage');
    expect(block!.querySelector('p')).toHaveTextContent('Erster Absatz');
    expect(block).not.toHaveTextContent('Zweiter Absatz');
  });

  it('setzt den Abschnittstitel des Einbauorts in den ersten Titelblock', () => {
    const { container } = render(
      <Markdown unterEbene={3} titel={<h3>Durchführung</h3>}>
        {'Erster Absatz\n\nZweiter Absatz'}
      </Markdown>,
    );
    const block = container.querySelector('.markdown > [data-lfh="titelblock"]');
    expect(block, 'kein Titelblock').not.toBeNull();
    expect(block!.firstElementChild).toHaveAttribute('data-lfh', 'titelplatz');
    expect(block!.querySelector('h3')).toHaveTextContent('Durchführung');
    expect(block!.querySelector('p')).toHaveTextContent('Erster Absatz');
    expect(screen.getAllByRole('heading', { name: 'Durchführung' })).toHaveLength(1);
  });

  it('rendert ohne Titel keinen Titelplatz', () => {
    const { container } = render(<Markdown unterEbene={3}>{'Absatz'}</Markdown>);
    expect(container.querySelector('[data-lfh="titelplatz"]')).toBeNull();
    expect(container.querySelector('[data-lfh="titelblock"]')).toBeNull();
  });

  it('rendert leeren Inhalt ohne Absturz', () => {
    const { container } = render(<Markdown unterEbene={3}>{''}</Markdown>);
    expect(container.querySelector('.markdown')).not.toBeNull();
  });

  /*
   * LFH-1056: Fundstellen der Volltextsuche werden im GERENDERTEN Text markiert, nicht im
   * Quelltext — Fettung, Listen und Links bleiben heil.
   */
  describe('Fundstellen', () => {
    const marken = (c: HTMLElement) => [...c.querySelectorAll('mark')].map((m) => m.textContent);

    it('markiert Wortanfänge in Fettung, Liste und Linktext', () => {
      const { container } = render(
        <Markdown unterEbene={2} fundstellen="Deich Nord">
          {
            '**Deichbruch** bei Hochdeich\n\n- Abschnitt Nord\n- [Deichplan](https://example.org/nord)'
          }
        </Markdown>,
      );
      expect(marken(container)).toEqual(['Deich', 'Nord', 'Deich']);
      expect(container.querySelector('strong')).toHaveTextContent('Deichbruch');
      expect(container.querySelector('strong mark')).toHaveTextContent('Deich');
      expect(container.querySelectorAll('li')).toHaveLength(2);
      const link = screen.getByRole('link', { name: 'Deichplan' });
      expect(link).toHaveAttribute('href', 'https://example.org/nord');
      expect(link.querySelector('mark')).toHaveClass('lfh-fundstelle');
    });

    it('ohne Begriff keine Markierung', () => {
      const { container } = render(<Markdown unterEbene={2}>{'Deichbruch'}</Markdown>);
      expect(container.querySelector('mark')).toBeNull();
    });

    // Spitze Klammern liest Markdown als rohes HTML und zeigt sie als Text; der Server findet
    // das Wort darin, also wird es auch markiert, ohne dass das HTML zum Element wird.
    it('markiert auch in rohem HTML, das als Text erscheint', () => {
      const { container } = render(
        <Markdown unterEbene={2} fundstellen="mark deich">
          {'Treffen am <Deich> bei <mark>roh</mark> markiert'}
        </Markdown>,
      );
      expect(container.querySelector('p')).toHaveTextContent(
        'Treffen am <Deich> bei <mark>roh</mark> markiert',
      );
      expect(marken(container)).toEqual(['Deich', 'mark', 'mark', 'mark']);
    });
  });
});
