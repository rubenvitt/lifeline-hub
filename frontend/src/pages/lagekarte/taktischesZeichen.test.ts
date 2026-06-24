import { describe, expect, it } from 'vitest';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import { baueTzProps, groesseAusLabel, einsatzortTz, schadenTz, uhsTz } from './taktischesZeichen';

describe('taktischesZeichen', () => {
  it('Einheit: Grundzeichen + Größe aus Label + Org-Default', () => {
    const p = baueTzProps({ objekttyp: 'einheit', einheitTypLabel: 'Gruppe', orgDefault: 'hilfsorganisation' });
    expect(p.grundzeichen).toBe('taktische-formation');
    expect(p.einheit).toBe('gruppe');
    expect(p.organisation).toBe('hilfsorganisation');
  });
  it('Objekt-Override schlägt Org-Default', () => {
    const p = baueTzProps({ objekttyp: 'fahrzeug', organisation: 'feuerwehr', orgDefault: 'hilfsorganisation' });
    expect(p.grundzeichen).toBe('kraftfahrzeug-landgebunden');
    expect(p.organisation).toBe('feuerwehr');
  });
  it('Abschnitt/Führung default fachaufgabe = fuehrung', () => {
    expect(baueTzProps({ objekttyp: 'abschnitt' }).fachaufgabe).toBe('fuehrung');
    expect(baueTzProps({ objekttyp: 'fuehrung' }).grundzeichen).toBe('person');
  });
  it('unbekanntes Größen-Label → keine Größe', () => {
    expect(groesseAusLabel('Sonstige')).toBeUndefined();
  });
  it('erzeugt valides SVG je Objekttyp', () => {
    for (const objekttyp of ['einheit', 'fahrzeug', 'fuehrung', 'abschnitt'] as const) {
      const svg = erzeugeTaktischesZeichen({
        ...baueTzProps({ objekttyp, einheitTypLabel: 'Gruppe', orgDefault: 'hilfsorganisation' }),
        skipFontRegistration: true,
      }).svg.render();
      expect(svg).toContain('<svg');
    }
  });
});

describe('einsatzortTz', () => {
  it('nutzt das Grundzeichen anlass', () => {
    expect(einsatzortTz().grundzeichen).toBe('anlass');
  });
});

describe('schadenTz', () => {
  it('nutzt gefahr-Dreieck, Farbe = Ausmaß', () => {
    expect(schadenTz('gering')).toEqual({ grundzeichen: 'gefahr', farbe: '#52c41a' });
    expect(schadenTz('mittel')).toEqual({ grundzeichen: 'gefahr', farbe: '#faad14' });
    expect(schadenTz('gross')).toEqual({ grundzeichen: 'gefahr', farbe: '#fa8c16' });
    expect(schadenTz('katastrophal')).toEqual({ grundzeichen: 'gefahr', farbe: '#f5222d' });
  });
  it('Fallback-Farbe bei unbekanntem Ausmaß', () => {
    expect(schadenTz('unbekannt' as never).farbe).toBe('#8c8c8c');
  });
});

describe('uhsTz', () => {
  it('mappt jeden UhsTyp auf stelle + passendes Sanitäts-Overlay', () => {
    expect(uhsTz('behandlungsplatz')).toEqual({ grundzeichen: 'stelle', fachaufgabe: 'aerztliche-versorgung' });
    expect(uhsTz('patientenablage')).toEqual({ grundzeichen: 'stelle', symbol: 'sammelplatz-betroffene' });
    expect(uhsTz('verletztensammelstelle')).toEqual({ grundzeichen: 'stelle', symbol: 'sammeln' });
    expect(uhsTz('sonstige')).toEqual({ grundzeichen: 'stelle', fachaufgabe: 'rettungswesen' });
  });
});

describe('Render-Integration (Library akzeptiert die Mapper-Props)', () => {
  const render = (p: object) =>
    erzeugeTaktischesZeichen({ ...p, skipFontRegistration: true }).svg.render();

  it('erzeugt valides SVG für Einsatzort und alle UHS-Typen', () => {
    expect(render(einsatzortTz())).toContain('<svg');
    for (const typ of ['behandlungsplatz', 'patientenablage', 'verletztensammelstelle', 'sonstige'] as const) {
      expect(render(uhsTz(typ))).toContain('<svg');
    }
  });

  it('Schaden-Farbe landet tatsächlich im gerenderten SVG', () => {
    const svg = render(schadenTz('katastrophal'));
    expect(svg).toContain('<svg');
    expect(svg).toContain('#f5222d');
  });
});
