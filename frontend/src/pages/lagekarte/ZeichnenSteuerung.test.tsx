import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import ZeichnenSteuerung from './ZeichnenSteuerung';

function setup(overrides = {}) {
  const props = {
    aktiv: true,
    titel: 'Gefahrengebiet · Fläche',
    phase: 'zeichnen' as const,
    onAbschliessen: vi.fn(),
    onAbbrechen: vi.fn(),
    onSpeichern: vi.fn(),
    onVerwerfen: vi.fn(),
    ...overrides,
  };
  render(
    <App>
      <ZeichnenSteuerung {...props} />
    </App>,
  );
  return props;
}

describe('ZeichnenSteuerung', () => {
  it('rendert nichts, wenn inaktiv', () => {
    const { container } = render(
      <App>
        <ZeichnenSteuerung aktiv={false} titel="x" phase="zeichnen"
          onAbschliessen={vi.fn()} onAbbrechen={vi.fn()} onSpeichern={vi.fn()} onVerwerfen={vi.fn()} />
      </App>,
    );
    expect(container.textContent).not.toContain('Abschließen');
  });

  it('Phase zeichnen: zeigt Titel + Hinweis + Abschließen/Abbrechen', async () => {
    const p = setup();
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(screen.getByText(/Punkte per Klick setzen/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
    expect(p.onAbschliessen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(p.onAbbrechen).toHaveBeenCalledTimes(1);
  });

  it('Phase bestaetigen: zeigt Speichern/Verwerfen', async () => {
    const p = setup({ phase: 'bestaetigen' });
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(p.onSpeichern).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(p.onVerwerfen).toHaveBeenCalledTimes(1);
  });

  it('Phase bestaetigen mit speichernLaeuft: Speichern zeigt Loading', () => {
    setup({ phase: 'bestaetigen', speichernLaeuft: true });
    // antd Button loading rendert eine Spinner-Struktur; Button bleibt im DOM.
    expect(screen.getByRole('button', { name: /Speichern/ })).toHaveClass('ant-btn-loading');
  });
});
