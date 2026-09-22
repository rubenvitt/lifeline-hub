import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { act } from 'react';
import { renderMitProviders } from '../../test/utils';
import { dichten } from '../../theme/tokens';
import KartenUeberlagerung, {
  GrundlageLeiste,
  kartenKnopfKante,
  naechsterFreierIndex,
} from './KartenUeberlagerung';
import { erzeugeZeigerQuelle } from './mausPosition';
import { grundlageOptionen } from './leistenDaten';

const STILE = [{ name: 'Liberty', url: 'x', typ: 'vektor', attribution: null }] as never[];

function basis(over: Partial<Parameters<typeof KartenUeberlagerung>[0]> = {}) {
  return {
    grundlage: null,
    zeigerQuelle: erzeugeZeigerQuelle(),
    onZoomRein: vi.fn(),
    onZoomRaus: vi.fn(),
    onNorden: vi.fn(),
    onZeichnen: vi.fn(),
    ...over,
  };
}

describe('KartenUeberlagerung — Knopfblock', () => {
  it('ruft Zoom, Nordung und Zeichnen über benannte Knöpfe', () => {
    const p = basis();
    renderMitProviders(<KartenUeberlagerung {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hineinzoomen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Herauszoomen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nach Norden ausrichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zeichenwerkzeuge' }));
    expect(p.onZoomRein).toHaveBeenCalledTimes(1);
    expect(p.onZoomRaus).toHaveBeenCalledTimes(1);
    expect(p.onNorden).toHaveBeenCalledTimes(1);
    expect(p.onZeichnen).toHaveBeenCalledTimes(1);
  });

  it('ohne Schreibrecht (kein onZeichnen) gibt es keinen Zeichnen-Knopf', () => {
    renderMitProviders(<KartenUeberlagerung {...basis({ onZeichnen: undefined })} />);
    expect(screen.queryByRole('button', { name: 'Zeichenwerkzeuge' })).not.toBeInTheDocument();
  });

  it('die Knopfkante folgt dem Dichte-Boden, nie unter die 32 px des Entwurfs', () => {
    expect(kartenKnopfKante({ controlHeight: dichten.kompakt.zeilenhoehe })).toBe(32);
    expect(kartenKnopfKante({ controlHeight: dichten.komfortabel.zeilenhoehe })).toBe(48);
    expect(kartenKnopfKante({ controlHeight: dichten.handschuh.zeilenhoehe })).toBe(72);
  });
});

describe('KartenUeberlagerung — Zeigerkoordinate', () => {
  it('zeigt „—" ohne Zeiger und die Koordinate im Format der Einstellungen', () => {
    const q = erzeugeZeigerQuelle();
    renderMitProviders(<KartenUeberlagerung {...basis({ zeigerQuelle: q })} />);
    const anzeige = document.querySelector('[data-lfh="zeiger-koordinate"]') as HTMLElement;
    expect(anzeige).toHaveTextContent('—');
    act(() => q.melde({ lat: 51.1, lon: 4.1 }));
    // Ohne Einsatz-Provider gilt die Vorgabe (WGS84 dezimal) — dieselbe wie im Inspector.
    expect(anzeige).toHaveTextContent('51.10000, 4.10000');
  });
});

describe('GrundlageLeiste', () => {
  it('sperrt nicht konfigurierte Grundlagen mit Grund, statt sie wegzulassen', () => {
    renderMitProviders(
      <GrundlageLeiste optionen={grundlageOptionen([], false)} wert="blind" onWechsel={() => {}} />,
    );
    expect(screen.getByRole('radio', { name: 'Online' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Offline' })).toHaveAttribute(
      'title',
      'Offline-Karte nicht konfiguriert',
    );
    expect(screen.getByRole('radio', { name: 'Blind' })).toBeChecked();
  });

  it('wählt per Pfeiltaste und überspringt dabei Gesperrtes', () => {
    const onWechsel = vi.fn();
    renderMitProviders(
      <GrundlageLeiste
        optionen={grundlageOptionen(STILE, false)}
        wert="online:Liberty"
        onWechsel={onWechsel}
      />,
    );
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Liberty' }), { key: 'ArrowRight' });
    expect(onWechsel).toHaveBeenCalledWith('blind');
  });
});

describe('naechsterFreierIndex', () => {
  it('springt über gesperrte Segmente und bricht bei lauter Sperren ab', () => {
    expect(naechsterFreierIndex('ArrowRight', 0, [false, true, false])).toBe(2);
    expect(naechsterFreierIndex('ArrowLeft', 0, [false, true, false])).toBe(2);
    expect(naechsterFreierIndex('Home', 2, [true, false, false])).toBe(1);
    expect(naechsterFreierIndex('End', 0, [false, false, true])).toBe(1);
    expect(naechsterFreierIndex('ArrowRight', 0, [true, true])).toBeNull();
    expect(naechsterFreierIndex('a', 0, [false, false])).toBeNull();
  });
});
