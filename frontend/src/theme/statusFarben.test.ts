import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import * as sf from './statusFarben';
import { antdToken, farbenDunkel, farbenHell, type Farbrollen } from './tokens';

/** Vollständiger GlobalToken eines Modus — dieselbe Ableitung wie im `ThemeModeProvider`,
 *  damit der Test die echte Kette Rolle → antd-Token prüft und nicht ein Stück davon. */
function tokenFuer(farben: Farbrollen, dunkel: boolean) {
  return theme.getDesignToken({
    algorithm: dunkel ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: antdToken(farben),
  });
}

const hellToken = tokenFuer(farbenHell, false);
const dunkelToken = tokenFuer(farbenDunkel, true);
const ALLE_ROLLEN: sf.Statusrolle[] = ['alarm', 'achtung', 'normal', 'neutral', 'bedien', 'marke'];

const ALLE_MAPS = {
  statusKategorie: sf.statusKategorie,
  verfuegbarkeit: sf.verfuegbarkeit,
  etbTyp: sf.etbTyp,
  uhsStatus: sf.uhsStatus,
  uhsTyp: sf.uhsTyp,
  brStatus: sf.brStatus,
  belegungsArt: sf.belegungsArt,
  warnstufeKarte: sf.warnstufeKarte,
  warnstufeKennzahl: sf.warnstufeKennzahl,
};

describe('Statusfarb-Vertrag', () => {
  it('gibt jedem Eintrag einen zweiten Kanal (WCAG 1.4.1)', () => {
    for (const [name, map] of Object.entries(ALLE_MAPS)) {
      for (const [schluessel, d] of Object.entries(map)) {
        expect(d.label, `${name}.${schluessel} ohne Text`).toBeTruthy();
        expect(d.label.trim(), `${name}.${schluessel} nur Leerraum`).not.toBe('');
      }
    }
  });

  it('hält die zwei Warnstufen-Lesarten getrennt — der Widerspruch ist benannt, nicht zufällig', () => {
    expect(sf.warnstufeKarte.keine.rolle).toBe('alarm');
    expect(sf.warnstufeKennzahl.keine.rolle).toBe('normal');
  });

  it('nutzt keine gesättigte Farbe für den Normalzustand (ASM, A1 Festlegung 5)', () => {
    expect(sf.uhsStatus.aktiv.rolle).toBe('normal');
    expect(sf.statusKategorie.verfuegbar.rolle).toBe('normal');
  });

  it('löst die Divergenz `gebunden` (gold vs. orange) zu EINER Rolle auf', () => {
    expect(sf.statusKategorie.gebunden.rolle).toBe('achtung');
  });

  it('trägt selbst keinen Farbwert — Farben stehen nur in tokens.ts/rollen.css', () => {
    for (const map of Object.values(ALLE_MAPS)) {
      for (const d of Object.values(map)) {
        expect(JSON.stringify(d)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      }
    }
  });

  it('übersetzt jede Rolle in einen Farbwert des aktiven Modus', () => {
    for (const rolle of ALLE_ROLLEN) {
      for (const token of [hellToken, dunkelToken]) {
        expect(sf.rollenFarbe(rolle, token), `${rolle} ohne Farbwert`).toMatch(/^(#|rgb)/i);
      }
    }
  });

  it('gibt verschiedenen Rollen verschiedene Farbwerte — sonst wäre der Kanal blind', () => {
    const werte = ALLE_ROLLEN.map((r) => sf.rollenFarbe(r, hellToken).toLowerCase());
    expect(new Set(werte).size).toBe(werte.length);
  });

  it('folgt dem Modus — `marke` hat keinen antd-Token und muss trotzdem umschalten', () => {
    expect(sf.rollenFarbe('marke', hellToken)).toBe(farbenHell.marke);
    expect(sf.rollenFarbe('marke', dunkelToken)).toBe(farbenDunkel.marke);
    expect(sf.rollenFarbe('alarm', hellToken)).not.toBe(sf.rollenFarbe('alarm', dunkelToken));
  });

  it('fällt ohne unsere Tokens auf den Hellmodus zurück, statt zu werfen', () => {
    expect(sf.rollenFarbe('marke', theme.getDesignToken({}))).toBe(farbenHell.marke);
  });
});
