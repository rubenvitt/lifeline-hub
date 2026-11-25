#!/usr/bin/env node
// Erzeugt die nativen Design-Tokens der Helfer-Apps aus dem Design System der Oberfläche:
//   docs/design/design-system/project/tokens.json
//     → ios/HelferKern/Sources/HelferKern/Tokens.swift
//     → android/helferkern/src/main/kotlin/dev/rubeen/lifeline/helferkern/Tokens.kt
// Die Ausgabe ist deterministisch (Reihenfolge der JSON, keine Zeitstempel). Der Wächter
// `scripts/check-design-tokens-nativ.sh` (Schritt 21 von check-all.sh) erzeugt sie neu und
// vergleicht mit dem Stand im Repo.
//
//   node scripts/design/tokens-nativ.mjs                    schreibt ins Repo
//   node scripts/design/tokens-nativ.mjs --nach <ordner>    schreibt dieselben Pfade unter <ordner>
//
// Regeln: Token-Name in lowerCamelCase (`rolle-grund` → `rolleGrund`). Farben sind Paare
// nacht/tag als ARGB-Zahl 0xAARRGGBB (Swift: UInt32, Kotlin: Long; `rgba(…)` trägt seinen
// Alphawert in AA). Längen sind Punkte (iOS) bzw. dp (Android) als einfache Zahlen, Schriften
// stehen mit dem Namen der Familie (die Schriftdateien liegen in den App-Zielen).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const QUELLE = "docs/design/design-system/project/tokens.json";
const SWIFT = "ios/HelferKern/Sources/HelferKern/Tokens.swift";
const KOTLIN = "android/helferkern/src/main/kotlin/dev/rubeen/lifeline/helferkern/Tokens.kt";
const KOPF = `Erzeugt aus ${QUELLE} von scripts/design/tokens-nativ.mjs — nicht von Hand ändern.`;

// `-` und `_` trennen Wörter (`autobahn_parken` → `autobahnParken`).
export function lowerCamel(name) {
  const teile = name.split(/[-_]/).filter(Boolean);
  return teile.map((t, i) => (i === 0 ? t : t[0].toUpperCase() + t.slice(1))).join("");
}

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");

/** `#rrggbb` oder `rgba(r, g, b, a)` → 0xAARRGGBB als Text. */
export function argb(wert) {
  let m = /^#([0-9a-fA-F]{6})$/.exec(wert);
  if (m) return `0xFF${m[1].toUpperCase()}`;
  m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\s*\)$/.exec(wert);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const a = Math.round(Number(m[4]) * 255);
    if ([r, g, b].some((x) => x > 255) || a > 255) throw new Error(`Farbe außer Bereich: ${wert}`);
    return `0x${hex2(a)}${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  throw new Error(`Unbekannte Farbform: ${wert}`);
}

/** `13.5px` → 13.5; Ganzzahlen bekommen `.0`, damit der Typ in beiden Sprachen Double ist. */
export function laenge(wert) {
  const m = /^(-?[0-9.]+)px$/.exec(wert);
  if (!m) throw new Error(`Keine px-Länge: ${wert}`);
  return zahl(Number(m[1]));
}

export function zahl(n) {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** Erster Name der CSS-Familienliste: `'LFH Archivo', system-ui, …` → `LFH Archivo`. */
export function familienname(liste) {
  const m = /^\s*'([^']+)'/.exec(liste);
  if (!m) throw new Error(`Keine benannte Familie: ${liste}`);
  return m[1];
}

function lies() {
  const d = JSON.parse(readFileSync(join(WURZEL, QUELLE), "utf8"));
  const namen = new Set();
  const frisch = (gruppe, name) => {
    const id = `${gruppe}.${lowerCamel(name)}`;
    if (namen.has(id)) throw new Error(`Doppelter Name nach lowerCamelCase: ${id}`);
    namen.add(id);
    return lowerCamel(name);
  };
  const farben = d.color.tokens.map((t) => ({
    name: frisch("farbe", t.name),
    nacht: argb(t.value.nacht),
    tag: argb(t.value.tag),
  }));
  const langen = (gruppe, tokens) =>
    tokens.map((t) => ({ name: frisch(gruppe, t.name), wert: laenge(t.value) }));
  const familien = Object.entries(d.type.families).map(([schluessel, liste]) => ({
    name: frisch("schrift", `familie-${schluessel}`),
    wert: familienname(liste),
  }));
  const stile = d.type.groups.flatMap((g) =>
    g.styles.map((s) => ({
      name: frisch("schrift", s.name),
      familie: lowerCamel(`familie-${g.family}`),
      groesse: laenge(s.fontSize),
      zeilenhoehe: zahl(s.lineHeight),
      gewicht: s.fontWeight,
    })),
  );
  return {
    farben,
    abstand: langen("abstand", d.spacing.tokens),
    groesse: langen("groesse", d.size.tokens),
    radius: langen("radius", d.radius.tokens),
    familien,
    stile,
  };
}

function swift(t) {
  const z = [];
  z.push(`// ${KOPF}`, "", "// swiftlint:disable all", "");
  z.push("/// Ein Farbwert je Thema: `nacht` (dunkel) und `tag` (hell), je als ARGB `0xAARRGGBB`.");
  z.push("public struct Paar: Sendable, Equatable {");
  z.push("    public let nacht: UInt32");
  z.push("    public let tag: UInt32");
  z.push("    public init(nacht: UInt32, tag: UInt32) {");
  z.push("        self.nacht = nacht");
  z.push("        self.tag = tag");
  z.push("    }");
  z.push("}", "");
  z.push("/// Ein Schriftstil der Skala: Familie, Größe in Punkten, Zeilenhöhe als Faktor, Gewicht (CSS-Wert).");
  z.push("public struct Schriftstil: Sendable, Equatable {");
  z.push("    public let familie: String");
  z.push("    public let groesse: Double");
  z.push("    public let zeilenhoehe: Double");
  z.push("    public let gewicht: Int");
  z.push("    public init(familie: String, groesse: Double, zeilenhoehe: Double, gewicht: Int) {");
  z.push("        self.familie = familie");
  z.push("        self.groesse = groesse");
  z.push("        self.zeilenhoehe = zeilenhoehe");
  z.push("        self.gewicht = gewicht");
  z.push("    }");
  z.push("}", "");
  z.push("public enum LifelineFarbe {");
  for (const f of t.farben)
    z.push(`    public static let ${f.name} = Paar(nacht: ${f.nacht}, tag: ${f.tag})`);
  z.push("}", "");
  for (const [typ, liste] of [
    ["LifelineAbstand", t.abstand],
    ["LifelineGroesse", t.groesse],
    ["LifelineRadius", t.radius],
  ]) {
    z.push(`public enum ${typ} {`);
    for (const l of liste) z.push(`    public static let ${l.name}: Double = ${l.wert}`);
    z.push("}", "");
  }
  z.push("public enum LifelineSchrift {");
  for (const f of t.familien) z.push(`    public static let ${f.name} = "${f.wert}"`);
  z.push("");
  for (const s of t.stile)
    z.push(
      `    public static let ${s.name} = Schriftstil(familie: ${s.familie}, groesse: ${s.groesse}, zeilenhoehe: ${s.zeilenhoehe}, gewicht: ${s.gewicht})`,
    );
  z.push("}", "");
  return z.join("\n");
}

function kotlin(t) {
  const z = [];
  z.push(`// ${KOPF}`, "", "package dev.rubeen.lifeline.helferkern", "");
  z.push("/** Ein Farbwert je Thema: `nacht` (dunkel) und `tag` (hell), je als ARGB `0xAARRGGBB`. */");
  z.push("data class Paar(val nacht: Long, val tag: Long)", "");
  z.push("/** Ein Schriftstil der Skala: Familie, Größe in sp, Zeilenhöhe als Faktor, Gewicht (CSS-Wert). */");
  z.push("data class Schriftstil(val familie: String, val groesse: Double, val zeilenhoehe: Double, val gewicht: Int)", "");
  z.push("object LifelineFarbe {");
  for (const f of t.farben)
    z.push(`    val ${f.name} = Paar(nacht = ${f.nacht}, tag = ${f.tag})`);
  z.push("}", "");
  for (const [typ, liste] of [
    ["LifelineAbstand", t.abstand],
    ["LifelineGroesse", t.groesse],
    ["LifelineRadius", t.radius],
  ]) {
    z.push("/** Werte in dp. */");
    z.push(`object ${typ} {`);
    for (const l of liste) z.push(`    const val ${l.name}: Double = ${l.wert}`);
    z.push("}", "");
  }
  z.push("object LifelineSchrift {");
  for (const f of t.familien) z.push(`    const val ${f.name} = "${f.wert}"`);
  z.push("");
  for (const s of t.stile)
    z.push(
      `    val ${s.name} = Schriftstil(familie = ${s.familie}, groesse = ${s.groesse}, zeilenhoehe = ${s.zeilenhoehe}, gewicht = ${s.gewicht})`,
    );
  z.push("}", "");
  return z.join("\n");
}

export function erzeuge() {
  const t = lies();
  return { [SWIFT]: swift(t), [KOTLIN]: kotlin(t) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let ziel = WURZEL;
  if (args[0] === "--nach") {
    if (!args[1]) {
      console.error("FEHLER: --nach braucht einen Ordner.");
      process.exit(2);
    }
    ziel = resolve(args[1]);
  } else if (args.length > 0) {
    console.error("FEHLER: erlaubt ist nur --nach <ordner>.");
    process.exit(2);
  }
  for (const [pfad, inhalt] of Object.entries(erzeuge())) {
    const voll = join(ziel, pfad);
    mkdirSync(dirname(voll), { recursive: true });
    writeFileSync(voll, inhalt);
    console.log(`geschrieben: ${pfad}`);
  }
}
