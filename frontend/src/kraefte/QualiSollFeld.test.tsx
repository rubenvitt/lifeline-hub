import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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
