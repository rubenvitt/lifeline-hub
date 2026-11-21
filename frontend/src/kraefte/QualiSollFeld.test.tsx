import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { Button, Form } from 'antd';
import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Feld from '../components/instrument/Feld';
import { QUALI_SOLL_MAX } from '../api/eingabegrenzen';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { optionenVon, oeffne } from '../test/auswahlListe';
import QualiSollFeld, { vollstaendig, type QualiSollZeile } from './QualiSollFeld';

/** LLH-1553: gemeinsames Feld für das Qualifikationssoll. */

function Huelle({ start }: { start: QualiSollZeile[] }) {
  const [zeilen, setZeilen] = useState(start);
  return (
    <>
      <QualiSollFeld
        value={zeilen}
        onChange={setZeilen}
        bekannt={[{ qualifikation_id: 9, label: 'Altqualifikation', anzahl: 1 }]}
      />
      <output>{JSON.stringify(vollstaendig(zeilen))}</output>
    </>
  );
}

function render(start: QualiSollZeile[] = []) {
  server.use(
    http.get('/api/qualifikationen', () =>
      HttpResponse.json([
        { id: 1, label: 'Sanitäter', sortier: 10 },
        { id: 2, label: 'Rettungssanitäter', sortier: 20, schliesst_ein_id: 1 },
      ]),
    ),
  );
  return renderMitProviders(<Huelle start={start} />);
}

describe('QualiSollFeld', () => {
  it('ohne Zeile steht nur der Knopf', () => {
    render();
    expect(screen.getByRole('button', { name: 'Qualifikation fordern' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('eine gewählte Qualifikation steht in anderen Zeilen nicht mehr zur Wahl', async () => {
    render([{ qualifikation_id: 2, anzahl: 1 }, { anzahl: 1 }]);
    await oeffne('Qualifikation 2');
    expect(optionenVon('Qualifikation 2')).toEqual(['Sanitäter', 'Altqualifikation']);
  });

  it('Entfernen nimmt die Zeile heraus; unvollständige Zeilen gehen nicht hinaus', async () => {
    render([{ qualifikation_id: 2, anzahl: 3 }, { anzahl: 1 }]);
    expect(screen.getByRole('status')).toHaveTextContent('[{"qualifikation_id":2,"anzahl":3}]');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation 1 entfernen' }));
    expect(screen.getByRole('status')).toHaveTextContent('[]');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('mehr als die Grenze lässt der Knopf nicht zu', () => {
    render(Array.from({ length: QUALI_SOLL_MAX }, (_, i) => ({ qualifikation_id: i, anzahl: 1 })));
    expect(screen.getByRole('button', { name: 'Qualifikation fordern' })).toBeDisabled();
  });
});

describe('QualiSollFeld prüft die Anzahl (LLH-1768)', () => {
  it('eine entfernte ungültige Zeile sperrt nicht mehr', async () => {
    server.use(http.get('/api/qualifikationen', () => HttpResponse.json([])));
    const onFinish = vi.fn();
    renderMitProviders(
      <Form
        onFinish={onFinish}
        initialValues={{
          q: [
            { qualifikation_id: 2, anzahl: 3 },
            { qualifikation_id: 1, anzahl: 1 },
          ],
        }}
      >
        <Feld name="q" label="Soll">
          <QualiSollFeld />
        </Feld>
        <Button htmlType="submit">Senden</Button>
      </Form>,
    );
    const anzahl2 = screen.getByRole('spinbutton', { name: 'Anzahl 2' });
    fireEvent.change(anzahl2, { target: { value: '0' } });
    fireEvent.blur(anzahl2);
    expect(anzahl2).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation 2 entfernen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
  });

  it('ein gespeicherter Altwert über der Grenze steht nicht rot da', () => {
    render([{ qualifikation_id: 2, anzahl: 100000 }]);
    expect(screen.getByRole('spinbutton', { name: 'Anzahl 1' })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
