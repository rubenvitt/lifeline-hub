import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { merkeLetztenOrt } from './letzterOrt';
import { useEinsatzRueckweg } from './einsatzRueckweg';

/**
 * Der Rückweg „Zurück zu <Einsatz>“ (LFH-954, LLH-1731 D1): eine Quelle für die Seiten der
 * Ebene 1 und die Hilfe.
 */
describe('useEinsatzRueckweg', () => {
  const aktiv = { id: 5, bezeichnung: 'Starkregen Nord', status: 'aktiv' };
  let abrufe = 0;

  beforeEach(() => {
    localStorage.clear();
    abrufe = 0;
  });

  function Sonde({ benutzerId, isAktiv }: { benutzerId: number | undefined; isAktiv: boolean }) {
    const rueckweg = useEinsatzRueckweg(benutzerId, isAktiv);
    return (
      <span data-testid="rueckweg">{rueckweg ? `${rueckweg.label} → ${rueckweg.pfad}` : '—'}</span>
    );
  }

  function setup(
    einsaetze: unknown[],
    { benutzerId = 1, isAktiv = true }: { benutzerId?: number | null; isAktiv?: boolean } = {},
  ) {
    server.use(
      http.get('/api/einsaetze', () => {
        abrufe += 1;
        return HttpResponse.json(einsaetze);
      }),
    );
    return renderMitProviders(<Sonde benutzerId={benutzerId ?? undefined} isAktiv={isAktiv} />);
  }

  /** Lange genug, dass eine Abfrage angekommen wäre; sonst bewiese ein „—“ nichts. */
  const kurzWarten = () => new Promise((r) => setTimeout(r, 50));

  it('führt an den gemerkten Pfad eines aktiven, gelisteten Einsatzes', async () => {
    merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/lagekarte' });
    setup([aktiv]);
    await waitFor(() =>
      expect(screen.getByTestId('rueckweg')).toHaveTextContent(
        'Zurück zu Starkregen Nord → /einsaetze/5/lagekarte',
      ),
    );
  });

  it('kein Rückweg bei abgeschlossenem Einsatz', async () => {
    merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
    setup([{ ...aktiv, status: 'abgeschlossen' }]);
    await waitFor(() => expect(abrufe).toBe(1));
    await kurzWarten();
    expect(screen.getByTestId('rueckweg')).toHaveTextContent('—');
  });

  it('kein Rückweg, wenn der Einsatz nicht in der Liste der Person steht', async () => {
    merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
    setup([{ ...aktiv, id: 6 }]);
    await waitFor(() => expect(abrufe).toBe(1));
    await kurzWarten();
    expect(screen.getByTestId('rueckweg')).toHaveTextContent('—');
  });

  it('ohne gemerkten Ort weder Rückweg noch Abruf der Liste', async () => {
    setup([aktiv]);
    await kurzWarten();
    expect(screen.getByTestId('rueckweg')).toHaveTextContent('—');
    expect(abrufe).toBe(0);
  });

  it('nicht gefragt (aktiv falsch): weder Rückweg noch Abruf', async () => {
    merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
    setup([aktiv], { isAktiv: false });
    await kurzWarten();
    expect(screen.getByTestId('rueckweg')).toHaveTextContent('—');
    expect(abrufe).toBe(0);
  });

  it('ohne Person weder Rückweg noch Abruf', async () => {
    merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
    setup([aktiv], { benutzerId: null });
    await kurzWarten();
    expect(screen.getByTestId('rueckweg')).toHaveTextContent('—');
    expect(abrufe).toBe(0);
  });
});
