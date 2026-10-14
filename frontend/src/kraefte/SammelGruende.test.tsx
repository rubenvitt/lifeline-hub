import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GruendeListe, gruendeTagRender } from './SammelGruende';

const gruende = new Map([[2, 'außer Dienst']]);
const name = (id: number) => (id === 2 ? 'Bernd Clausen (P-2)' : `Person ${id}`);

function Tag(props: { label: React.ReactNode; value: number }) {
  const T = gruendeTagRender(gruende, name);
  return (
    <T
      label={props.label}
      value={props.value}
      closable={false}
      onClose={() => {}}
      isMaxTag={false}
      disabled={false}
      index={0}
    />
  );
}

describe('Gründe am Tag', () => {
  it('trägt den Grund am Tag einer abgelehnten Kraft, als Wort', () => {
    render(<Tag label="Bernd Clausen (P-2)" value={2} />);
    expect(screen.getByText('Bernd Clausen (P-2) · außer Dienst')).toBeInTheDocument();
  });

  it('lässt eine angenommene Kraft unmarkiert', () => {
    render(<Tag label="Anna Berg (P-1)" value={1} />);
    expect(screen.getByText('Anna Berg (P-1)')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('nennt den festgehaltenen Namen, wenn die Option fehlt', () => {
    // antd gibt ohne Option den Wert als Label weiter.
    render(<Tag label={2} value={2} />);
    expect(screen.getByText('Bernd Clausen (P-2) · außer Dienst')).toBeInTheDocument();
  });
});

describe('Liste der Gründe', () => {
  it('zeigt nichts ohne Gründe', () => {
    const { container } = render(
      <GruendeListe gruende={new Map()} name={name} onAbwaehlen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('nennt jede abgelehnte Kraft mit Grund und wählt sie auf Knopfdruck ab', async () => {
    const onAbwaehlen = vi.fn();
    render(<GruendeListe gruende={gruende} name={name} onAbwaehlen={onAbwaehlen} />);
    expect(screen.getByRole('list', { name: 'Nicht disponiert' })).toHaveTextContent(
      'Bernd Clausen (P-2) – außer Dienst',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abgelehnte abwählen' }));
    expect(onAbwaehlen).toHaveBeenCalledOnce();
  });
});
