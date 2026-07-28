import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Form, Input } from 'antd';
import { renderMitProviders } from '../test/utils';
import { flaeche } from '../theme/tokens';
import EinsatzSeite from './EinsatzSeite';

const hier = dirname(fileURLToPath(import.meta.url));
const spracheCss = readFileSync(join(hier, '..', 'theme', 'sprache.css'), 'utf-8');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EinsatzSeite', () => {
  it('rendert Breadcrumb, Titel (level 4), Beschreibung, Aktionen, Hinweis und Children', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite
        breadcrumb={<nav>Einsätze / Personen</nav>}
        titel="Personen"
        beschreibung="Betreute und vermisste Personen"
        aktionen={<Button type="primary">Anlegen</Button>}
        hinweis={<div>Nur lesend</div>}
      >
        <div>Seiteninhalt</div>
      </EinsatzSeite>,
    );
    const heading = screen.getByRole('heading', { name: 'Personen' });
    // Gleiche Ebene wie `AdminPage` — eine Seite ist eine Seite (Spec §3.1).
    expect(heading.tagName).toBe('H4');
    expect(screen.getByText('Einsätze / Personen')).toBeInTheDocument();
    expect(screen.getByText('Betreute und vermisste Personen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeInTheDocument();
    expect(screen.getByText('Nur lesend')).toBeInTheDocument();
    expect(screen.getByText('Seiteninhalt')).toBeInTheDocument();
    // Signatur-Element 1 aus A0: der Akzentstrich steht über dem Titel.
    expect(container.querySelector('.lfh-marke__strich')).not.toBeNull();
  });

  it('hält die Container-Breite auf `flaeche.seiteSchmal` und lässt sie überschreiben', () => {
    // `renderMitProviders` legt eine `.ant-app`-Hülle um den Baum — die Wurzel des
    // Primitivs ist deren erstes Kind, nicht `container.firstElementChild`.
    const wurzel = (c: HTMLElement) => c.querySelector<HTMLElement>('.ant-app > div')!;

    const { container, unmount } = renderMitProviders(
      <EinsatzSeite titel="Schmal">
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(wurzel(container).style.maxWidth).toBe(`${flaeche.seiteSchmal}px`);
    unmount();

    const breit = renderMitProviders(
      <EinsatzSeite titel="Breit" breite={flaeche.seiteBreit}>
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(wurzel(breit.container).style.maxWidth).toBe(`${flaeche.seiteBreit}px`);
  });

  /**
   * Der Akzentstrich lebt als CSS-Klasse, und `vite.config.ts` setzt für Vitest
   * `css: false` — die Klassen-Assertion oben belegt also NUR das Attribut, keine
   * Wirkung. Dieser Guard (Muster: `theme/rollen.guard.test.ts`) pinnt deshalb die
   * Geometrie in der Quelle. Er macht zugleich die bewusste Kopplung laut: die
   * Klasse ist BEM-Kind von `.lfh-marke`; wer sie dort umbaut, bricht hier einen
   * Test statt still ein Primitiv.
   */
  it('der Akzentstrich in sprache.css trägt 36 × 3 px aus den Markenrollen', () => {
    const regel = spracheCss.match(/\.lfh-marke__strich\s*\{([^}]*)\}/);
    expect(regel).not.toBeNull();
    const block = regel![1];
    expect(block).toMatch(/width:\s*36px/);
    expect(block).toMatch(/height:\s*3px/);
    expect(block).toMatch(/background:\s*var\(--lfh-marke\)/);
    expect(block).toMatch(/box-shadow:\s*var\(--lfh-marke-glut\)/);
  });

  it('löst über einen Header-Button (außerhalb des Form) das Speichern via form.submit() aus', async () => {
    const onFinish = vi.fn();
    function Harness() {
      const [form] = Form.useForm();
      return (
        <EinsatzSeite
          titel="Titel"
          aktionen={
            <Button type="primary" onClick={() => form.submit()}>
              Speichern
            </Button>
          }
        >
          <Form form={form} onFinish={onFinish}>
            <Form.Item name="feld" initialValue="wert">
              <Input aria-label="feld" />
            </Form.Item>
          </Form>
        </EinsatzSeite>
      );
    }
    renderMitProviders(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onFinish).toHaveBeenCalledWith({ feld: 'wert' });
  });

  it('warnt in Dev, wenn der Aktionen-Slot mehr als eine Primäraktion trägt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderMitProviders(
      <EinsatzSeite
        titel="Personen"
        aktionen={
          <>
            <Button type="primary">Anlegen</Button>
            <Button type="primary">Importieren</Button>
          </>
        }
      >
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/Primäraktion/);
  });

  it('schweigt bei genau einer Primäraktion neben Nebenaktionen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderMitProviders(
      <EinsatzSeite
        titel="Personen"
        aktionen={
          <>
            <Button>Exportieren</Button>
            <Button type="primary">Anlegen</Button>
          </>
        }
      >
        {/* Ein Primär-Button IM Inhalt ist erlaubt — die Regel gilt nur für den Kopf. */}
        <Button type="primary">Speichern</Button>
      </EinsatzSeite>,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
