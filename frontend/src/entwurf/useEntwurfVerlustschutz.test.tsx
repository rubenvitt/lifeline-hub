import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { useState } from 'react';
import { useEntwurfVerlustschutz } from './useEntwurfVerlustschutz';

interface Daten {
  titel: string;
}

/** Minimaler Träger: ein Feld, ein Serverstand, den der Test von aussen nachschiebt. */
function Traeger({ daten, speichern }: { daten: Daten; speichern: (w: Daten) => Promise<unknown> }) {
  const [form] = Form.useForm<Daten>();
  const schutz = useEntwurfVerlustschutz<Daten, Daten>({
    daten,
    istEntwurf: true,
    form,
    werteAus: (d) => ({ titel: d.titel }),
    speichern,
    onFehler: () => {},
  });
  return (
    <Form form={form} onValuesChange={schutz.markiereGeaendert} onBlur={schutz.autosaveJetzt}>
      <Form.Item label="Titel" name="titel">
        <Input />
      </Form.Item>
      <output>{schutz.ungespeichert ? 'offen' : 'sauber'}</output>
      {schutz.zuletztGespeichert && <p>zuletzt gespeichert {schutz.zuletztGespeichert}</p>}
    </Form>
  );
}

function Huelle({ speichern = () => Promise.resolve() }: { speichern?: (w: Daten) => Promise<unknown> }) {
  const [daten, setDaten] = useState<Daten>({ titel: 'Server 1' });
  return (
    <>
      <Traeger daten={daten} speichern={speichern} />
      <button type="button" onClick={() => setDaten({ titel: 'Server 2' })}>
        fremd
      </button>
    </>
  );
}

/**
 * Die Seitentests (`BefehlDetailPage.test.tsx`, `LageberichtePage.test.tsx`) prüfen den
 * Hook im Zusammenspiel mit Query und Mutation. Hier steht die reine Mechanik — ohne
 * Server, ohne Router —, damit ein Fehler im Hook auf den Hook zeigt und nicht auf eine
 * der beiden Seiten.
 */
describe('useEntwurfVerlustschutz', () => {
  it('überschreibt ein berührtes Formular NICHT mit einem fremden Serverstand', async () => {
    render(<Huelle />);
    const feld = screen.getByLabelText('Titel');
    expect(feld).toHaveValue('Server 1');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Meine Fassung');
    // `fireEvent`, nicht `userEvent`: ein echter Klick blurrte das Feld, der Blur-Autosave
    // speicherte und räumte den Merker — die fremde Änderung träfe dann ein SAUBERES
    // Formular, und der Test prüfte den Riegel gar nicht (gemessen).
    fireEvent.click(screen.getByText('fremd'));
    expect(screen.getByLabelText('Titel')).toHaveValue('Meine Fassung');
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('übernimmt den Serverstand, solange nichts berührt wurde (Gegenaussage)', async () => {
    // Ein Riegel, der IMMER hält, machte die Seite still veraltet — und wäre mit dem
    // Test darüber allein nicht von einem richtigen zu unterscheiden.
    render(<Huelle />);
    fireEvent.click(screen.getByText('fremd'));
    expect(screen.getByLabelText('Titel')).toHaveValue('Server 2');
    expect(screen.getByText('sauber')).toBeInTheDocument();
  });

  it('speichert beim Verlassen eines Feldes und räumt den Merker', async () => {
    const speichern = vi.fn().mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    expect(speichern).not.toHaveBeenCalled();
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(speichern).toHaveBeenCalledWith({ titel: 'Server 1x' });
    expect(await screen.findByText('sauber')).toBeInTheDocument();
    expect(screen.getByText(/zuletzt gespeichert \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('speichert nichts, wenn nichts berührt wurde — auch nicht beim Verlassen', async () => {
    const speichern = vi.fn().mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    await userEvent.click(screen.getByLabelText('Titel'));
    await userEvent.tab();
    await act(async () => {});
    expect(speichern).not.toHaveBeenCalled();
  });

  it('warnt beim Reload nur mit offener Fassung', async () => {
    render(<Huelle />);
    let ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);

    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });
});
