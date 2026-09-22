import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Markdown from './Markdown';

describe('Markdown', () => {
  it('rendert eine Überschrift als heading-Element', () => {
    render(<Markdown unterEbene={3}>{'# Lageüberblick'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Lageüberblick' })).toBeInTheDocument();
  });

  /*
   * Die Ebene nennt der EINBAUORT (LFH-621), nicht eine feste Konstante: `unterEbene` ist die
   * Ebene der nächsten Überschrift über dem Text, `#` wird die Ebene darunter. Vorher rückte
   * alles pauschal um drei Stufen — im ETB, wo über dem Eintrag nur der Tageskopf steht,
   * fielen damit `###`, `####` und tiefer ohne Not alle auf `h6` zusammen.
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

  it('rendert leeren Inhalt ohne Absturz', () => {
    const { container } = render(<Markdown unterEbene={3}>{''}</Markdown>);
    expect(container.querySelector('.markdown')).not.toBeNull();
  });
});
