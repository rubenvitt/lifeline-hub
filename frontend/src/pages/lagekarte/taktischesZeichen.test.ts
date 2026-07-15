import { describe, expect, it } from 'vitest';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import {
  baueTzProps, groesseAusLabel, einsatzortTz, schadenTz, uhsTz,
  grundzeichenAusFahrzeugtyp, organisationAusText, fachaufgabeAusFahrzeugtyp,
  fachaufgabeAusFunktion, grundzeichenAkzeptiert,
} from './taktischesZeichen';

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

describe('LFH-171: Fahrzeug-Zeichen aus Fahrzeugtyp/OPTA ableiten', () => {
  describe('grundzeichenAusFahrzeugtyp (konservativ; Rest = generisch)', () => {
    it('Boot/Wasserfahrzeug → wasserfahrzeug', () => {
      expect(grundzeichenAusFahrzeugtyp('MZB')).toBe('wasserfahrzeug');
      expect(grundzeichenAusFahrzeugtyp('Mehrzweckboot')).toBe('wasserfahrzeug');
    });
    it('Kraftrad → zweirad (nicht das deprecated kraftrad)', () => {
      expect(grundzeichenAusFahrzeugtyp('Krad')).toBe('zweirad');
      expect(grundzeichenAusFahrzeugtyp('Motorrad')).toBe('zweirad');
    });
    it('Anhänger → anhaenger', () => {
      expect(grundzeichenAusFahrzeugtyp('FwA')).toBe('anhaenger');
      expect(grundzeichenAusFahrzeugtyp('Anhänger')).toBe('anhaenger');
    });
    it('Hubschrauber → hubschrauber', () => {
      expect(grundzeichenAusFahrzeugtyp('Hubschrauber')).toBe('hubschrauber');
    });
    it('unspezifischer/leerer Fahrzeugtyp → undefined (Fallback bleibt generisch)', () => {
      expect(grundzeichenAusFahrzeugtyp('LF 20')).toBeUndefined();
      expect(grundzeichenAusFahrzeugtyp('')).toBeUndefined();
      expect(grundzeichenAusFahrzeugtyp(null)).toBeUndefined();
    });
  });

  describe('organisationAusText (Trägerorganisation/OPTA-Freitext → OrganisationId)', () => {
    it('erkennt Organisationen an Schlüsselwörtern', () => {
      expect(organisationAusText('Feuerwehr München')).toBe('feuerwehr');
      expect(organisationAusText('THW OV Musterstadt')).toBe('thw');
      expect(organisationAusText('DRK Kreisverband')).toBe('hilfsorganisation');
      expect(organisationAusText('Polizei')).toBe('polizei');
      expect(organisationAusText('Bundeswehr')).toBe('bundeswehr');
    });
    it('unbekannter Text → undefined', () => {
      expect(organisationAusText('Stadtwerke')).toBeUndefined();
      expect(organisationAusText('')).toBeUndefined();
      expect(organisationAusText(null)).toBeUndefined();
    });
  });

  describe('fachaufgabeAusFahrzeugtyp (kuratierte Whitelist)', () => {
    it('mappt gängige Fahrzeugtypen auf Fachaufgaben', () => {
      expect(fachaufgabeAusFahrzeugtyp('LF 20')).toBe('brandbekaempfung');
      expect(fachaufgabeAusFahrzeugtyp('TLF 3000')).toBe('brandbekaempfung');
      expect(fachaufgabeAusFahrzeugtyp('RTW')).toBe('rettungswesen');
      expect(fachaufgabeAusFahrzeugtyp('GW-L')).toBe('logistik');
      expect(fachaufgabeAusFahrzeugtyp('ELW 1')).toBe('fuehrung');
    });
    it('unbekannter Fahrzeugtyp → undefined', () => {
      expect(fachaufgabeAusFahrzeugtyp('PKW')).toBeUndefined();
      expect(fachaufgabeAusFahrzeugtyp(null)).toBeUndefined();
    });
  });

  describe('baueTzProps – Fahrzeug-Ableitung + Override-Vorrang + accepts-Gating', () => {
    it('leitet Grundzeichen aus dem Fahrzeugtyp ab', () => {
      expect(baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'MZB' }).grundzeichen).toBe('wasserfahrzeug');
    });
    it('generischer Fahrzeugtyp behält das Kfz-Grundzeichen, leitet aber Fachaufgabe ab', () => {
      const p = baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'LF 20' });
      expect(p.grundzeichen).toBe('kraftfahrzeug-landgebunden');
      expect(p.fachaufgabe).toBe('brandbekaempfung');
    });
    it('leitet Organisation aus der Trägerorganisation ab', () => {
      expect(baueTzProps({ objekttyp: 'fahrzeug', traegerorganisation: 'Feuerwehr' }).organisation).toBe('feuerwehr');
    });
    it('OPTA ist Fallback für die Organisation, wenn kein Träger', () => {
      expect(baueTzProps({ objekttyp: 'fahrzeug', opta: 'THW-12/34' }).organisation).toBe('thw');
    });
    it('manueller tz_organisation-Override schlägt Ableitung UND Träger', () => {
      const p = baueTzProps({ objekttyp: 'fahrzeug', organisation: 'polizei', traegerorganisation: 'Feuerwehr' });
      expect(p.organisation).toBe('polizei');
    });
    it('manueller tz_fachaufgabe-Override schlägt die Fahrzeugtyp-Ableitung', () => {
      const p = baueTzProps({ objekttyp: 'fahrzeug', fachaufgabe: 'iuk', fahrzeugtyp: 'LF 20' });
      expect(p.fachaufgabe).toBe('iuk');
    });
    it('abgeleitete Organisation schlägt den Org-Default', () => {
      const p = baueTzProps({ objekttyp: 'fahrzeug', traegerorganisation: 'THW', orgDefault: 'feuerwehr' });
      expect(p.organisation).toBe('thw');
    });
    it('accepts-Gating: zweirad akzeptiert keine Overlays → Organisation/Fachaufgabe entfallen', () => {
      const p = baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'Krad', traegerorganisation: 'Feuerwehr', fachaufgabe: 'brandbekaempfung' });
      expect(p.grundzeichen).toBe('zweirad');
      expect(p.organisation).toBeUndefined();
      expect(p.fachaufgabe).toBeUndefined();
    });
    it('accepts-Gating: hubschrauber akzeptiert Organisation, aber keine Fachaufgabe', () => {
      const p = baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'Hubschrauber', traegerorganisation: 'Polizei', fachaufgabe: 'rettungswesen' });
      expect(p.grundzeichen).toBe('hubschrauber');
      expect(p.organisation).toBe('polizei');
      expect(p.fachaufgabe).toBeUndefined();
    });
  });

  describe('Render-Integration abgeleiteter Fahrzeug-Props', () => {
    const render = (p: object) =>
      erzeugeTaktischesZeichen({ ...p, skipFontRegistration: true }).svg.render();
    it('erzeugt valides SVG für abgeleitete Fahrzeug-Zeichen', () => {
      expect(render(baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'MZB', traegerorganisation: 'Feuerwehr' }))).toContain('<svg');
      expect(render(baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'Krad' }))).toContain('<svg');
      expect(render(baueTzProps({ objekttyp: 'fahrzeug', fahrzeugtyp: 'LF 20', traegerorganisation: 'Feuerwehr' }))).toContain('<svg');
    });
  });
});

describe('LFH-172: Personal-Zeichen aus Funktion differenzieren', () => {
  describe('fachaufgabeAusFunktion (Qualifikations-Text → Fachaufgabe, schmale Whitelist)', () => {
    it('mappt sanitäts-/ärztliche Qualifikationen', () => {
      expect(fachaufgabeAusFunktion('Notfallsanitäter')).toBe('rettungswesen');
      expect(fachaufgabeAusFunktion('Sanitäter, Gruppenführer')).toBe('rettungswesen');
      expect(fachaufgabeAusFunktion('Notarzt')).toBe('aerztliche-versorgung');
    });
    it('reine Führungsqualifikation → undefined (bleibt beim fuehrung-Default)', () => {
      expect(fachaufgabeAusFunktion('Zugführer')).toBeUndefined();
      expect(fachaufgabeAusFunktion(null)).toBeUndefined();
    });
  });

  describe('baueTzProps – Führungskraft-Ableitung', () => {
    it('Führungskraft erhält den DV-102-Funktions-Indikator + fuehrung-Default', () => {
      const p = baueTzProps({ objekttyp: 'fuehrung', istFuehrungskraft: true });
      expect(p.grundzeichen).toBe('person');
      expect(p.funktion).toBe('fuehrungskraft');
      expect(p.fachaufgabe).toBe('fuehrung');
    });
    it('leitet die Fachaufgabe aus dem Funktions-/Qualifikationstext ab', () => {
      const p = baueTzProps({ objekttyp: 'fuehrung', istFuehrungskraft: true, funktion: 'Notfallsanitäter, Gruppenführer' });
      expect(p.fachaufgabe).toBe('rettungswesen');
      expect(p.funktion).toBe('fuehrungskraft');
    });
    it('manueller tz_fachaufgabe-Override schlägt die Funktions-Ableitung', () => {
      const p = baueTzProps({ objekttyp: 'fuehrung', istFuehrungskraft: true, fachaufgabe: 'iuk', funktion: 'Sanitäter' });
      expect(p.fachaufgabe).toBe('iuk');
    });
    it('ohne Führungskraft-Flag kein Funktions-Indikator (nicht-Führung nicht als Führer markieren)', () => {
      const p = baueTzProps({ objekttyp: 'fuehrung', istFuehrungskraft: false });
      expect(p.funktion).toBeUndefined();
      expect(p.grundzeichen).toBe('person');
    });
  });

  describe('Render-Integration', () => {
    it('erzeugt valides SVG für eine Führungskraft mit Funktion + Fachaufgabe', () => {
      const svg = erzeugeTaktischesZeichen({
        ...baueTzProps({ objekttyp: 'fuehrung', istFuehrungskraft: true, funktion: 'Notfallsanitäter' }),
        skipFontRegistration: true,
      }).svg.render();
      expect(svg).toContain('<svg');
    });
  });
});

describe('grundzeichenAkzeptiert', () => {
  it('bekanntes Grundzeichen rendert das gelistete Overlay → true', () => {
    // 'stelle' akzeptiert laut DV-102-Katalog eine Fachaufgabe (uhsTz nutzt genau das).
    expect(grundzeichenAkzeptiert('stelle', 'fachaufgabe')).toBe(true);
  });
  it('unbekanntes Grundzeichen → false (?? false-Zweig: kein Phantom-Overlay)', () => {
    // Das Backend validiert grundzeichen NICHT gegen den Katalog → dieser Pfad ist erreichbar.
    expect(grundzeichenAkzeptiert('gibt-es-nicht', 'organisation')).toBe(false);
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
