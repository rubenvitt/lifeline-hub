import type {
  AktuelleBesetzung,
  EinsatzAnzeige,
  Fuehrungsfunktion,
  FuehrungsfunktionEintrag,
  Sachgebiet,
  Stab,
} from '../api/types';

/**
 * Optionsbau und Kodierung des Funktionskatalogs (LFH-549) — rein, damit alle Masken
 * (Auftrag, Erinnerung, Führungsstelle, ETB) dieselbe Auswahl und dieselbe Umkehr haben.
 *
 * Eine Katalogwahl trägt den Wert `funktion:<code>` bzw. `funktion:<code>:<Bezeichnung>`. Alles
 * andere ist Freitext: es gibt KEINEN Rückschluss von „S3“ im Rohtext auf den Code — ein „S 3“
 * fiele sonst still heraus. Führungshilfspersonal und Fachberater entstehen nur als
 * ausdrückliche Wahl aus dem Tipptext („Fachberater: THW“).
 *
 * Herleitung: `openspec/changes/archive/2026-09-30-lfh-549-funktionskatalog/design.md` (D5).
 */

export const FUNKTIONS_PRAEFIX = 'funktion:';

/** Katalog plus lesbare Besetzung (Name je Sachgebiet), falls der Stab freigegeben ist. */
export interface FunktionsVorschlaege {
  katalog: readonly FuehrungsfunktionEintrag[];
  /** Kurztext der Besetzung je Sachgebiet; leer ohne Stab-Recht. */
  besetzung: ReadonlyMap<Sachgebiet, string>;
}

export const KEINE_VORSCHLAEGE: FunktionsVorschlaege = { katalog: [], besetzung: new Map() };

export interface FunktionsOption {
  value: string;
  label: string;
}

export interface Funktionsangabe {
  funktion?: Fuehrungsfunktion;
  /** Freitext ohne Code, Bezeichnung bei Führungshilfspersonal/Fachberater. */
  text?: string;
}

/** Der Optionswert einer Katalogwahl. */
export function optionsWert(funktion: Fuehrungsfunktion, bezeichnung?: string): string {
  return bezeichnung
    ? `${FUNKTIONS_PRAEFIX}${funktion}:${bezeichnung}`
    : `${FUNKTIONS_PRAEFIX}${funktion}`;
}

const SACHGEBIETE: readonly string[] = ['s1', 's2', 's3', 's4', 's5', 's6'];

function alsSachgebiet(funktion: Fuehrungsfunktion): Sachgebiet | undefined {
  return SACHGEBIETE.includes(funktion) ? (funktion as Sachgebiet) : undefined;
}

/** „S2 – Lage (Müller)“ bzw. „Einsatzleitung“ — Anzeige einer Option ohne Bezeichnung. */
export function optionsLabel(
  eintrag: FuehrungsfunktionEintrag,
  besetzung: ReadonlyMap<Sachgebiet, string>,
): string {
  const grund =
    eintrag.kuerzel && eintrag.funktion !== 'el'
      ? `${eintrag.kuerzel} – ${eintrag.label}`
      : eintrag.label;
  const sg = alsSachgebiet(eintrag.funktion);
  const wer = sg ? besetzung.get(sg) : undefined;
  return wer ? `${grund} (${wer})` : grund;
}

/**
 * Die Optionen eines Empfängerfelds. Ohne Tipptext nur die Einträge ohne Pflicht-Bezeichnung;
 * mit Tipptext zusätzlich „Führungshilfspersonal: <Text>“ und „Fachberater: <Text>“.
 */
export function funktionsOptionen(
  vorschlaege: FunktionsVorschlaege,
  suchtext = '',
): FunktionsOption[] {
  const text = suchtext.trim();
  const feste = vorschlaege.katalog
    .filter((e) => !e.bezeichnung_pflicht)
    .map((e) => ({
      value: optionsWert(e.funktion),
      label: optionsLabel(e, vorschlaege.besetzung),
    }));
  const mitBezeichnung = text
    ? vorschlaege.katalog
        .filter((e) => e.bezeichnung_pflicht)
        .map((e) => ({ value: optionsWert(e.funktion, text), label: `${e.label}: ${text}` }))
    : [];
  return [...feste, ...mitBezeichnung];
}

/**
 * Die einzige Umkehr eines Feldwerts: `funktion:<code>[:<Bezeichnung>]` mit einem Code aus dem
 * Katalog → Katalogwahl; alles andere → Freitext (getrimmt, leer = nichts).
 */
export function dekodiere(
  wert: string,
  katalog: readonly FuehrungsfunktionEintrag[],
): Funktionsangabe {
  if (wert.startsWith(FUNKTIONS_PRAEFIX)) {
    const rest = wert.slice(FUNKTIONS_PRAEFIX.length);
    const trenner = rest.indexOf(':');
    const code = trenner === -1 ? rest : rest.slice(0, trenner);
    const eintrag = katalog.find((e) => e.funktion === code);
    if (eintrag) {
      const bezeichnung = trenner === -1 ? undefined : rest.slice(trenner + 1).trim();
      return bezeichnung
        ? { funktion: eintrag.funktion, text: bezeichnung }
        : { funktion: eintrag.funktion };
    }
  }
  const text = wert.trim();
  return text ? { text } : {};
}

/** Der Feldwert zu einer gespeicherten Angabe (Vorbelegung einer Maske). */
export function kodiere(angabe: Funktionsangabe): string | undefined {
  if (angabe.funktion) return optionsWert(angabe.funktion, angabe.text);
  return angabe.text || undefined;
}

/**
 * Kurztext der Besetzung für Vorschläge und Karten: der Name, sonst das Zustandswort. Nach der
 * Schwärzung fehlt der Name einer Person — dann steht nichts (keine erfundene Angabe).
 */
export function besetzungText(b: AktuelleBesetzung | undefined): string | undefined {
  if (!b) return undefined;
  switch (b.zustand) {
    case 'nicht_vergeben':
      return 'nicht vergeben';
    case 'einsatzleitung':
      return 'bei der Einsatzleitung';
    default:
      return b.name ?? undefined;
  }
}

/** Besetzungskarte aus dem Stab (nur belegte Zeilen; „nicht vergeben“ bleibt ohne Angabe). */
export function besetzungAusStab(stab: Stab | undefined): ReadonlyMap<Sachgebiet, string> {
  const karte = new Map<Sachgebiet, string>();
  for (const z of stab?.besetzung ?? []) {
    const text =
      z.besetzung_art === 'einsatzleitung' ? 'bei der Einsatzleitung' : (z.name ?? undefined);
    if (text) karte.set(z.sachgebiet, text);
  }
  return karte;
}

/**
 * Vorschläge für die ETB-Felder „Von“/„An“ (LFH-545/549): die Sachgebiete mit Besetzung im
 * Label, übernommen wird das Kürzel als Freitext — das ETB bekommt keinen Code, es bildet den
 * Funkverkehr ab.
 */
export function etbStabVorschlaege(vorschlaege: FunktionsVorschlaege): FunktionsOption[] {
  return vorschlaege.katalog
    .filter((e) => e.art === 'sachgebiet' && e.kuerzel)
    .map((e) => ({ value: e.kuerzel ?? '', label: optionsLabel(e, vorschlaege.besetzung) }));
}

/**
 * Vorrangregel der ETB-Vorbelegung „An“ (Stab-Spec LFH-46, Entscheidung 13): die gesetzte
 * Führungsstelle gewinnt immer; sonst das Kürzel des ersten eigenen Sachgebiets in S1–S6-Folge
 * (über `personal.benutzer_id`); sonst nichts. Seit LFH-894 nur noch der erste Vorschlag der
 * Rufname-Abfrage (`etb/RufnameAbfrage.tsx`); vorbelegt wird kein Eintrag mehr.
 */
export function anVorbelegung(
  einsatz: Pick<EinsatzAnzeige, 'meine_fuehrungsstelle' | 'meine_sachgebiete'>,
): string | undefined {
  const stelle = einsatz.meine_fuehrungsstelle?.trim();
  if (stelle) return stelle;
  const erstes = [...(einsatz.meine_sachgebiete ?? [])].sort()[0];
  return erstes ? erstes.toUpperCase() : undefined;
}

/**
 * Anzeige eines Empfängers: der Snapshot, dahinter die aktuelle Besetzung, falls der Server sie
 * aufgelöst hat — „S3 Einsatz · Schulz“, „S4 Versorgung · nicht vergeben“. Ohne Auflösung steht
 * der Snapshot allein, kein Platzhalter.
 */
export function mitBesetzung(snapshot: string, besetzung?: AktuelleBesetzung | null): string {
  const wer = besetzungText(besetzung ?? undefined);
  return wer ? `${snapshot} · ${wer}` : snapshot;
}
