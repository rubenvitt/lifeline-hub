import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoGroupedOptions, DEMO_GROUP } from './demoAuswahl';

interface Eintrag {
  id: number;
  name: string;
  ist_demo: boolean;
}

const label = (e: Eintrag) => e.name;

describe('demoGroupedOptions', () => {
  /** Eingang weder nach id noch nach Name sortiert: eine Sortierung im Helfer fiele auf. */
  it('stellt echte Einträge flach vorn, Demo-Einträge als Gruppe dahinter', () => {
    const optionen = demoGroupedOptions<Eintrag>(
      [
        { id: 3, name: 'Cäsar', ist_demo: true },
        { id: 4, name: 'Dora', ist_demo: false },
        { id: 1, name: 'Anton', ist_demo: true },
        { id: 2, name: 'Berta', ist_demo: false },
      ],
      label,
    );
    expect(optionen.map((o) => ('value' in o ? o.value : o.title))).toEqual([4, 2, DEMO_GROUP]);
    const gruppe = optionen[2];
    expect('options' in gruppe && gruppe.options.map((o) => o.value)).toEqual([3, 1]);
  });

  it('zeigt ohne Demo-Einträge keine Gruppe und hält die Eingangsreihenfolge', () => {
    const optionen = demoGroupedOptions<Eintrag>(
      [
        { id: 4, name: 'Dora', ist_demo: false },
        { id: 2, name: 'Berta', ist_demo: false },
      ],
      label,
    );
    expect(optionen).toEqual([
      { value: 4, label: 'Dora' },
      { value: 2, label: 'Berta' },
    ]);
  });

  it('liefert nur Demo-Einträge als einzige Gruppe, jeder mit Text und Marke', () => {
    const optionen = demoGroupedOptions<Eintrag>([{ id: 1, name: 'Anton', ist_demo: true }], label);
    expect(optionen).toHaveLength(1);
    const gruppe = optionen[0];
    if (!('options' in gruppe)) throw new Error('Gruppe erwartet');
    expect(gruppe.title).toBe(DEMO_GROUP);
    render(<>{gruppe.options[0].label}</>);
    expect(screen.getByText('Anton')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('liefert für eine leere Liste keine Optionen', () => {
    expect(demoGroupedOptions<Eintrag>([], label)).toEqual([]);
  });
});
