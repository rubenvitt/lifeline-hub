import type {
  ChatErwaehnung,
  EinsatzAnzeige,
  Fuehrungsfunktion,
  FuehrungsfunktionEintrag,
  MitgliedAnzeige,
  Stab,
} from '../api/types';

/**
 * `@`-Erwähnungen in der Chat-Eingabe (LLH-1220, Change `kcjecn9e-benachrichtigungskonzept`,
 * design.md D9). Vorgeschlagen werden die Mitglieder des Einsatzes und die besetzten Funktionen;
 * beim Senden geht die Liste der Erwähnten mit, der Text trägt nur `@Anzeige`. Der Server parst
 * den Text nicht. Die Eingabe löst ihn mit {@link erwaehnungenAusText} nur gegen die Vorschläge
 * auf, die aus der Auswahl übernommen wurden: ein getipptes „@S4“ wird nie zum Code
 * (`frontend/src/fuehrung/AGENTS.md`, kein Rückschluss vom Freitext).
 */
export interface ErwaehnungVorschlag {
  /** Was nach dem `@` im Text steht; je Vorschlag eindeutig. */
  wert: string;
  /** Zeile in der Auswahl. */
  label: string;
  erwaehnung: ChatErwaehnung;
}

/**
 * Die Funktionen, die im Einsatz jemand trägt: Einsatzleiter der Führungsstelle, Stab-Besetzung
 * (eine Person oder „bei der Einsatzleitung“) und die Funktion einer Mitgliedschaft. Das sind die
 * Wege, über die der Server eine Funktion in Nutzer auflöst.
 */
export function besetzteFunktionen(
  mitglieder: readonly MitgliedAnzeige[],
  stab: Stab | undefined,
  einsatz: EinsatzAnzeige | undefined,
): Set<Fuehrungsfunktion> {
  const besetzt = new Set<Fuehrungsfunktion>();
  if (einsatz?.einsatzleiter?.art === 'personal') besetzt.add('el');
  for (const z of stab?.besetzung ?? []) {
    if (z.besetzung_art === 'personal' || z.besetzung_art === 'einsatzleitung') {
      besetzt.add(z.sachgebiet);
    }
  }
  for (const m of mitglieder) if (m.fuehrungsfunktion) besetzt.add(m.fuehrungsfunktion);
  return besetzt;
}

/**
 * Vorschläge für die Eingabe: erst die besetzten Funktionen mit Kürzel (EL, S1–S7) in
 * Katalogfolge, dann die Mitglieder ohne die eigene Person. Ein doppelter Anzeigename bekommt den
 * Benutzernamen dazu, damit jeder Wert genau eine Person meint.
 */
export function erwaehnungsVorschlaege(
  katalog: readonly FuehrungsfunktionEintrag[],
  besetzt: ReadonlySet<Fuehrungsfunktion>,
  mitglieder: readonly MitgliedAnzeige[],
  eigeneId: number | undefined,
): ErwaehnungVorschlag[] {
  const funktionen: ErwaehnungVorschlag[] = katalog
    .filter((e) => e.kuerzel && besetzt.has(e.funktion))
    .map((e) => ({
      wert: e.kuerzel as string,
      label: e.funktion === 'el' ? e.label : `${e.kuerzel} – ${e.label}`,
      erwaehnung: { funktion: e.funktion },
    }));
  const andere = mitglieder.filter((m) => m.benutzer_id !== eigeneId);
  const namen = new Map<string, number>();
  for (const m of andere) {
    const n = m.anzeigename.trim().toLocaleLowerCase('de');
    namen.set(n, (namen.get(n) ?? 0) + 1);
  }
  const vergeben = new Set(funktionen.map((f) => f.wert.toLocaleLowerCase('de')));
  const personen: ErwaehnungVorschlag[] = andere.map((m) => {
    const name = m.anzeigename.trim();
    const schluessel = name.toLocaleLowerCase('de');
    const wert =
      (namen.get(schluessel) ?? 0) > 1 || vergeben.has(schluessel)
        ? `${name} (${m.benutzername})`
        : name;
    return {
      wert,
      label: m.fuehrungsstelle_anzeige ? `${wert} · ${m.fuehrungsstelle_anzeige}` : wert,
      erwaehnung: { benutzer_id: m.benutzer_id },
    };
  });
  return [...funktionen, ...personen];
}

const WORTZEICHEN = /[\p{L}\p{N}_]/u;

/**
 * Die Erwähnten eines Texts: an jedem `@` der längste Vorschlag, dessen Wert dort steht und an
 * einer Wortgrenze endet (Groß- und Kleinschreibung egal). Ein gelöschter `@Name` fällt so von
 * selbst heraus; „@Anna“ trifft nicht „@Anna Albers“. Jede Erwähnung höchstens einmal, in der
 * Reihenfolge des Texts.
 */
export function erwaehnungenAusText(
  text: string,
  vorschlaege: readonly ErwaehnungVorschlag[],
): ChatErwaehnung[] {
  const klein = text.toLocaleLowerCase('de');
  const nachLaenge = [...vorschlaege]
    .map((v) => ({ v, wert: v.wert.toLocaleLowerCase('de') }))
    .sort((a, b) => b.wert.length - a.wert.length);
  const gesehen = new Set<string>();
  const ergebnis: ChatErwaehnung[] = [];
  for (let i = klein.indexOf('@'); i !== -1; i = klein.indexOf('@', i + 1)) {
    const treffer = nachLaenge.find(({ wert }) => {
      if (!klein.startsWith(wert, i + 1)) return false;
      const danach = klein.charAt(i + 1 + wert.length);
      return danach === '' || !WORTZEICHEN.test(danach);
    });
    if (!treffer) continue;
    const schluessel = JSON.stringify(treffer.v.erwaehnung);
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    ergebnis.push(treffer.v.erwaehnung);
  }
  return ergebnis;
}
