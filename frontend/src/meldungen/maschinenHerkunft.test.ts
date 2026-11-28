import { describe, expect, it } from 'vitest';
import { herkunftKurz, herkunftText } from './maschinenHerkunft';

describe('Herkunft eines Maschinen-Vorschlags (LLH-2112)', () => {
  it('nennt Adapter, Knoten mit Name und Kennung und die Signatur', () => {
    expect(
      herkunftText({
        adapter: 'meshtastic',
        sender_id: '!a1b2c3d4',
        sender_name: 'Nord-1',
        signed: false,
      }),
    ).toBe('Mesh · Knoten „Nord-1“ (!a1b2c3d4) · nicht signiert');
  });

  it('nennt ohne Namen nur die Kennung', () => {
    expect(herkunftText({ adapter: 'meshtastic', sender_id: '!77ee01ff', signed: true })).toBe(
      'Mesh · Knoten !77ee01ff · signiert',
    );
  });

  it('liest auch die Herkunft einer übernommenen Meldung', () => {
    expect(
      herkunftText({ adapter: 'meshtastic', kennung: '!77ee01ff', name: null, signiert: true }),
    ).toBe('Mesh · Knoten !77ee01ff · signiert');
  });

  it('zeigt einen unbekannten Adapter als Kennwort', () => {
    expect(
      herkunftText({ adapter: 'postfach', sender_id: 'lage@example.org', signed: false }),
    ).toMatch(/^postfach · /);
  });

  it('kürzt für das Etikett auf Name, sonst Kennung', () => {
    expect(
      herkunftKurz({
        adapter: 'meshtastic',
        kennung: '!a1b2c3d4',
        name: 'Nord-1',
        signiert: false,
      }),
    ).toBe('Mesh · Nord-1 · nicht signiert');
    expect(herkunftKurz({ adapter: 'postfach', kennung: 'x', signiert: true })).toBe(
      'postfach · x · signiert',
    );
  });
});
