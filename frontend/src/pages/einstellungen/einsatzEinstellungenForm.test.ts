import { describe, expect, it } from 'vitest';
import {
  feldrasterStil,
  initialAllgemein,
  initialAufbewahrung,
  initialVerhalten,
  normalisiereAllgemein,
  normalisiereAufbewahrung,
  normalisiereVerhalten,
  orgHinweisAutoEtb,
  orgHinweisSelect,
  orgHinweisWert,
  zuUpdate,
} from './einsatzEinstellungenForm';
import type { EinsatzEinstellungen } from '../../api/types';

/**
 * Fixture mit AUSSCHLIESSLICH unterscheidbaren Nicht-null-Werten.
 *
 * Das ist keine Bequemlichkeit, sondern die Bedingung dafür, dass der `toEqual` unten
 * überhaupt etwas aussagt: `expect({a:1}).toEqual({a:1, b:undefined})` ist in Vitest grün,
 * ein fehlender Schlüssel liest sich also wie `undefined`. Eine Fixture aus lauter `null`
 * (wie `VERHALTEN_DEFAULTS` im Bestandstest der Seite) macht denselben Vergleich grün,
 * obwohl drei Felder unterwegs verloren gingen — genau der Fehler, den dieser Test fangen soll.
 */
const VOLL = {
  einsatz_id: 1,
  standard_modul: 'etb',
  basemap_modus: 'offline',
  karten_zoom_start: 12,
  fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
  zeitzone: 'Europe/Berlin',
  zeitformat: '12h',
  einheiten: 'imperial',
  koordinatenformat: 'mgrs',
  etb_nummer_praefix: 'EB-',
  etb_nummer_start: 100,
  meldung_nummer_praefix: 'M-',
  meldung_nummer_start: 200,
  auftrag_nummer_praefix: 'A-',
  auftrag_nummer_start: 300,
  meldung_bestaetigung_frist_min: 30,
  auftrag_quittierung_frist_min: 45,
  auto_etb_eintraege: 0,
  retention_dauer_tage: 90,
  etb_nummer_eingefroren: false,
  meldung_nummer_eingefroren: false,
  auftrag_nummer_eingefroren: false,
  org_defaults: { org_id: 1 },
  geaendert_at: null,
  geaendert_von: null,
} as unknown as EinsatzEinstellungen;

describe('zuUpdate', () => {
  it('mappt alle 18 Felder des Vollersatz-Payloads aus dem geladenen Zustand', () => {
    expect(zuUpdate(VOLL)).toEqual({
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
      etb_nummer_praefix: 'EB-',
      etb_nummer_start: 100,
      meldung_nummer_praefix: 'M-',
      meldung_nummer_start: 200,
      auftrag_nummer_praefix: 'A-',
      auftrag_nummer_start: 300,
      meldung_bestaetigung_frist_min: 30,
      auftrag_quittierung_frist_min: 45,
      auto_etb_eintraege: false,
      retention_dauer_tage: 90,
    });
  });

  it('haelt die Karten-Defaults fest (LFH-319) — der Vollersatz-PUT nullt sie sonst', () => {
    // Namentlich, weil diese drei Felder als EINZIGE in keiner Sektion sichtbar sind: sie
    // leben seit LFH-319 auf der Lagekarte. Ein Leser, der die Sektionen durchgeht, findet
    // keinen Grund für sie — der Test ist der Grund.
    const u = zuUpdate(VOLL);
    expect(u.basemap_modus).toBe('offline');
    expect(u.karten_zoom_start).toBe(12);
    expect(u.fachebenen_sichtbar).toEqual({
      nina: true,
      dwd: false,
      pegelonline: false,
      kritis: false,
    });
  });

  it('haelt „erbt Org-Standard" fuer auto_etb als null fest, nicht als true', () => {
    // Die Einsatz-Ebene ist DREIwertig (null = erbt Org, 0 = Aus, sonst An); die Org-Ebene
    // ist zweiwertig und rechnet `!== 0`, was null zu `true` machte. Wer die Org-Zeile
    // hierher kopiert, verwandelt ein „erbt Org" beim Speichern einer FREMDEN Sektion still
    // in ein explizites „An" — ohne Fehlerbild.
    const erbt = { ...VOLL, auto_etb_eintraege: null } as unknown as EinsatzEinstellungen;
    expect(zuUpdate(erbt).auto_etb_eintraege).toBeNull();
    expect(
      zuUpdate({ ...VOLL, auto_etb_eintraege: 1 } as unknown as EinsatzEinstellungen)
        .auto_etb_eintraege,
    ).toBe(true);
    expect(zuUpdate(VOLL).auto_etb_eintraege).toBe(false);
  });

  it('reicht null-Felder als null durch (leer = Org-Standard greift im Backend)', () => {
    const leer = {
      ...VOLL,
      standard_modul: null,
      zeitzone: null,
      retention_dauer_tage: null,
      etb_nummer_start: null,
    } as unknown as EinsatzEinstellungen;
    const u = zuUpdate(leer);
    expect(u.standard_modul).toBeNull();
    expect(u.zeitzone).toBeNull();
    expect(u.retention_dauer_tage).toBeNull();
    expect(u.etb_nummer_start).toBeNull();
  });
});

describe('Vollersatz-Merge ueber die Sektionsgrenze', () => {
  it('laesst die fremden Sektionen als Bestandswert mitfahren', () => {
    // Der eigentliche Vertrag dieses Moduls: eine Sektion schickt IHRE Felder, alle anderen
    // fahren aus dem geladenen Stand mit. Ohne das nullt ein Speichern in „Aufbewahrung"
    // die Nummernkreise — stumm, ohne roten Test und ohne Fehlerbild.
    const payload = {
      ...zuUpdate(VOLL),
      ...normalisiereAufbewahrung({ retention_dauer_tage: 365 }),
    };
    expect(payload.retention_dauer_tage).toBe(365);
    expect(payload.etb_nummer_praefix).toBe('EB-');
    expect(payload.etb_nummer_start).toBe(100);
    expect(payload.meldung_nummer_start).toBe(200);
    expect(payload.auftrag_nummer_start).toBe(300);
    expect(payload.standard_modul).toBe('etb');
    expect(payload.basemap_modus).toBe('offline');
  });

  it('laesst „Allgemein" die Verhalten- und Aufbewahrungsfelder unberuehrt', () => {
    const payload = {
      ...zuUpdate(VOLL),
      ...normalisiereAllgemein({ standard_modul: 'lage-dashboard' }),
    };
    expect(payload.standard_modul).toBe('lage-dashboard');
    expect(payload.zeitzone).toBeNull(); // eigenes Feld, im Formular geleert
    expect(payload.retention_dauer_tage).toBe(90);
    expect(payload.auftrag_quittierung_frist_min).toBe(45);
  });
});

describe('normalisiereAllgemein', () => {
  it('trimmt die Zeitzone, macht Leeres zu null und fuellt fehlende Enums mit null', () => {
    expect(normalisiereAllgemein({ zeitzone: '  Europe/Berlin  ', standard_modul: '' })).toEqual({
      standard_modul: null,
      zeitzone: 'Europe/Berlin',
      zeitformat: null,
      einheiten: null,
      koordinatenformat: null,
    });
  });
});

describe('normalisiereVerhalten', () => {
  it('macht aus einem geleerten Praefix null, nicht ""', () => {
    expect(normalisiereVerhalten({ etb_nummer_praefix: '  ' }).etb_nummer_praefix).toBeNull();
  });

  it('reicht alle neun Verhalten-Felder durch; undefined → null (erbt Org)', () => {
    expect(
      normalisiereVerhalten({ meldung_nummer_praefix: 'M-', meldung_nummer_start: 7 }),
    ).toEqual({
      etb_nummer_praefix: null,
      etb_nummer_start: null,
      meldung_nummer_praefix: 'M-',
      meldung_nummer_start: 7,
      auftrag_nummer_praefix: null,
      auftrag_nummer_start: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: null,
    });
  });

  it('unterscheidet „Aus" (false) von „erbt Org" (undefined)', () => {
    expect(normalisiereVerhalten({ auto_etb_eintraege: false }).auto_etb_eintraege).toBe(false);
    expect(normalisiereVerhalten({}).auto_etb_eintraege).toBeNull();
  });
});

describe('normalisiereAufbewahrung', () => {
  it('macht aus einem geleerten Feld null', () => {
    expect(normalisiereAufbewahrung({})).toEqual({ retention_dauer_tage: null });
  });
});

describe('initial* (Umkehr fuer die Formularvorbelegung)', () => {
  it('macht aus null undefined — antd zeigt sonst den Platzhalter nicht', () => {
    const leer = {
      ...VOLL,
      standard_modul: null,
      zeitzone: null,
      etb_nummer_praefix: null,
      retention_dauer_tage: null,
      auto_etb_eintraege: null,
    } as unknown as EinsatzEinstellungen;
    expect(initialAllgemein(leer).standard_modul).toBeUndefined();
    expect(initialAllgemein(leer).zeitzone).toBeUndefined();
    expect(initialVerhalten(leer).etb_nummer_praefix).toBeUndefined();
    expect(initialVerhalten(leer).auto_etb_eintraege).toBeUndefined();
    expect(initialAufbewahrung(leer).retention_dauer_tage).toBeUndefined();
  });

  it('bildet die Tristate auf den Select ab (0 → Aus, 1 → An)', () => {
    expect(initialVerhalten(VOLL).auto_etb_eintraege).toBe(false);
    expect(
      initialVerhalten({ ...VOLL, auto_etb_eintraege: 1 } as unknown as EinsatzEinstellungen)
        .auto_etb_eintraege,
    ).toBe(true);
  });

  it('uebernimmt die gespeicherten Werte in ihre jeweilige Sektion', () => {
    expect(initialAllgemein(VOLL)).toEqual({
      standard_modul: 'etb',
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
    });
    expect(initialAufbewahrung(VOLL)).toEqual({ retention_dauer_tage: 90 });
    expect(initialVerhalten(VOLL)).toEqual({
      etb_nummer_praefix: 'EB-',
      etb_nummer_start: 100,
      meldung_nummer_praefix: 'M-',
      meldung_nummer_start: 200,
      auftrag_nummer_praefix: 'A-',
      auftrag_nummer_start: 300,
      meldung_bestaetigung_frist_min: 30,
      auftrag_quittierung_frist_min: 45,
      auto_etb_eintraege: false,
    });
  });
});

describe('feldrasterStil', () => {
  it('schaltet erst auf zwei Spalten um — die Ungleichheit ist die Aussage', () => {
    // Ein dichte-/breitenblinder Festwert faellt nur ueber den Vergleich beider Zustaende
    // auf; „ist ein Grid" allein waere in beiden Faellen wahr.
    expect(feldrasterStil(false, 16).gridTemplateColumns).toBe('1fr');
    expect(feldrasterStil(true, 16).gridTemplateColumns).toBe('1fr 1fr');
    expect(feldrasterStil(true, 16).columnGap).toBe(16);
  });
});

describe('orgHinweisWert / orgHinweisSelect / orgHinweisAutoEtb', () => {
  it('liefert OHNE Org-Default gar nichts — sonst stuende „Standard (Org): null" da', () => {
    expect(orgHinweisWert(null)).toBeUndefined();
    expect(orgHinweisSelect(null, [{ value: '24h', label: '24 Stunden' }])).toBeUndefined();
    expect(orgHinweisAutoEtb(null)).toBeUndefined();
  });

  it('nennt das sichtbare Label, nicht den Wire-Wert', () => {
    expect(orgHinweisWert(365, 'Tage')).toBe('Standard (Org): 365 Tage');
    expect(orgHinweisSelect('24h', [{ value: '24h', label: '24 Stunden' }])).toBe(
      'Standard (Org): 24 Stunden',
    );
    expect(orgHinweisAutoEtb(0)).toBe('Standard (Org): Aus');
    expect(orgHinweisAutoEtb(1)).toBe('Standard (Org): An');
  });
});
