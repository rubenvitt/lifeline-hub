import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ComponentProps } from 'react';
import EinsatzortBand from './EinsatzortBand';

function zeige(props: ComponentProps<typeof EinsatzortBand>) {
  return render(
    <MemoryRouter>
      <EinsatzortBand {...props} />
    </MemoryRouter>,
  );
}

describe('EinsatzortBand (LLH-1953)', () => {
  it('nennt ohne Adresse „Einsatzort fehlt“', () => {
    zeige({ adresse: null });
    const region = screen.getByRole('region', { name: 'Einsatzort' });
    expect(region).toHaveTextContent('Einsatzort fehlt');
  });

  it('nennt mit Adresse ohne Punkt „Einsatzort nicht verortet“ und die Adresse', () => {
    zeige({ adresse: 'Hauptstraße 12, Musterstadt' });
    const region = screen.getByRole('region', { name: 'Einsatzort' });
    expect(region).toHaveTextContent('Einsatzort nicht verortet');
    expect(region).toHaveTextContent('Hauptstraße 12, Musterstadt');
    expect(region).not.toHaveTextContent('fehlt');
  });

  it('wertet eine Adresse nur aus Leerzeichen als fehlend', () => {
    zeige({ adresse: '   ' });
    expect(screen.getByRole('region', { name: 'Einsatzort' })).toHaveTextContent(
      'Einsatzort fehlt',
    );
  });

  it('trägt ohne Schreibrecht keinen Knopf und keinen Sprung', () => {
    zeige({ adresse: null });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('startet mit „Auf der Karte setzen“ das Platzieren', async () => {
    const onPlatzieren = vi.fn();
    zeige({ adresse: null, onPlatzieren });
    await userEvent.click(screen.getByRole('button', { name: 'Auf der Karte setzen' }));
    expect(onPlatzieren).toHaveBeenCalledTimes(1);
  });

  it('springt mit „Adresse eintragen“ in die Einsatzdaten', () => {
    zeige({ adresse: null, adressePfad: '/einsaetze/1/einsatzdaten?paneel=einsatzort' });
    expect(screen.getByRole('link', { name: 'Adresse eintragen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzdaten?paneel=einsatzort',
    );
  });

  it('holt sich die Zeigerereignisse zurück (Band im Fuß-Rahmen ohne Zeiger)', () => {
    zeige({ adresse: null });
    const band = document.querySelector<HTMLElement>('[data-lfh="einsatzort-band"]');
    expect(band?.style.pointerEvents).toBe('auto');
  });
});
