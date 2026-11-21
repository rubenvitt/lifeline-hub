import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Form, Input } from 'antd';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import DatenfeldEingabe from './DatenfeldEingabe';
import Feld from './Feld';
import { useEingabeSperre } from './eingabeSperre';

/** Ein Steuerelement, das einen Grund meldet, wie die Zeiteingabe nach dem Verlassen. */
function Sperrer({ grund, ...rest }: { grund: string | null; id?: string }) {
  const meldeSperre = useEingabeSperre();
  useEffect(() => meldeSperre(grund), [grund, meldeSperre]);
  return <Input aria-label="Wert" {...rest} />;
}

function Formular({
  onFinish,
  grund,
  zweiter = null,
}: {
  onFinish: (w: unknown) => void;
  grund: string | null;
  zweiter?: string | null;
}) {
  return (
    <Form onFinish={onFinish}>
      <Feld name="x" label="X">
        <Sperrer grund={grund} />
      </Feld>
      <ZweiterSperrer grund={zweiter} />
      <Button htmlType="submit">Senden</Button>
    </Form>
  );
}

/** Ein zweites Steuerelement desselben Felds (wie der Beginn eines Zeitraums). */
function ZweiterSperrer({ grund }: { grund: string | null }) {
  return grund === null ? null : <Sperrer grund={grund} />;
}

describe('Eingabesperre über `Feld` (LLH-1768)', () => {
  it('ein gemeldeter Grund sperrt das Senden und steht in der Fehlerzeile', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Formular onFinish={onFinish} grund="nicht lesbar" />);
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('nicht lesbar')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('fällt der Grund weg, verschwindet die Fehlerzeile und das Senden geht', async () => {
    const onFinish = vi.fn();
    const { rerender } = renderMitProviders(<Formular onFinish={onFinish} grund="nicht lesbar" />);
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('nicht lesbar');
    rerender(<Formular onFinish={onFinish} grund={null} />);
    await waitFor(() => expect(screen.queryByText('nicht lesbar')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
  });

  it('ohne `Feld` meldet das Steuerelement ins Leere', () => {
    renderMitProviders(<Sperrer grund="nicht lesbar" />);
    expect(screen.getByLabelText('Wert')).toBeInTheDocument();
  });

  it('sperrt auch in `DatenfeldEingabe`', async () => {
    const onFinish = vi.fn();
    renderMitProviders(
      <Form onFinish={onFinish}>
        <DatenfeldEingabe name="y" label="Y">
          <Sperrer grund="nicht lesbar" />
        </DatenfeldEingabe>
        <Button htmlType="submit">Senden</Button>
      </Form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('nicht lesbar')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe('Eingabesperre mit zwei Quellen', () => {
  it('bleibt gesperrt, solange eine Quelle einen Grund meldet', async () => {
    const onFinish = vi.fn();
    function Zwei({ a, b }: { a: string | null; b: string | null }) {
      return (
        <Form onFinish={onFinish}>
          <Feld name="z" label="Z">
            <Doppel a={a} b={b} />
          </Feld>
          <Button htmlType="submit">Senden</Button>
        </Form>
      );
    }
    const { rerender } = renderMitProviders(<Zwei a="nicht lesbar" b="Tag gibt es nicht" />);
    rerender(<Zwei a={null} b="Tag gibt es nicht" />);
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Tag gibt es nicht')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

function Doppel({ a, b }: { a: string | null; b: string | null; id?: string }) {
  return (
    <>
      <Sperrer grund={a} />
      <Melder grund={b} />
    </>
  );
}

function Melder({ grund }: { grund: string | null }) {
  const meldeSperre = useEingabeSperre();
  useEffect(() => meldeSperre(grund), [grund, meldeSperre]);
  return null;
}
