import { describe, expect, it } from 'vitest';
import { scanneApiTypen, type ApiTypFund } from './apiTypScan';

/**
 * Guard (LFH-265, Teil A): im API-Seam werden Response-Formen NICHT von Hand beschrieben.
 *
 * WARUM. Eine handgerollte Response-Form driftet STILL gegen das Backend. Es gibt keinen roten
 * Test und keinen auffälligen Request — der Client liest ein Feld, das es nicht mehr gibt, und
 * bekommt `undefined`. Genau diese Klasse hat LFH-265 im Karten-Bereich gemessen: `maxzoom` und
 * `update_verfuegbar` waren in der Handrolle OPTIONAL, obwohl das Backend sie immer liefert, und
 * `OnlineStyle.typ` war ein FE-eigener Union statt des generierten. Der Typ-Codegen (LFH-120) ist
 * die Gegenmaßnahme; dieser Guard hält den erreichten Stand.
 *
 * ERKENNUNGS-MECHANIK GEERBT von `queryKeys.guard.test.ts` / `queryKeyScan.ts` (LFH-312):
 * TS-AST statt zeilenlokaler Regex, das `import.meta.glob` bleibt im Guard-Test statt im Scanner.
 * Bewusst KEINE zweite zeilenbasierte Variante. Erfasste Formen und die Grenzen des Scanners
 * stehen im Kopfkommentar von `apiTypScan.ts` — die Liste ist Teil des Vertrags.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * ZWEISTUFIGE ERLAUBNIS. Anders als die queryKeys-Allowlist ist diese Erlaubnis PERMANENT,
 * keine Migrationsschuld: Request-/Eingabe-DTOs bleiben laut CLAUDE.md („Noch handgepflegt
 * (bewusst, FE-lokal)") dauerhaft handgerollt. Sie schrumpft nicht auf leer.
 *
 *  STUFE 1 — NAMENSKONVENTION ({@link REQUEST_DTO_KONVENTION}). Request-DTOs heißen in diesem
 *    Repo durchgängig `…Eingabe`, `…Patch`, `…Body`, `…Filter`, `…Update` oder `Neuer…`/
 *    `Neue…`/`Neues…`/`Patch…`. Gemessen: 62 der 75 exportierten Objekt-Typen im API-Seam.
 *    Die Konvention trägt, WEIL Response-Typen die Namen ihrer Rust-Gegenstücke erben
 *    (`…Anzeige`, `…Antwort`, `…Detail`) und diese Suffixe nie treffen.
 *
 *  STUFE 2 — GEMESSENE AUSNAHMEN ({@link AUSNAHMEN}). Alles, was Stufe 1 nicht trifft, braucht
 *    einen Eintrag MIT Begründung. Seed gegen den Stand dieses Branches gemessen (13 Einträge),
 *    nicht abgeschrieben. Ein STALE-CHECK unten hält die Liste frei von Leichen.
 *
 * WAS DIESER GUARD NICHT LEISTET:
 *  - Er prüft die FORM (Handrolle vs. Re-Export), nicht die RICHTIGKEIT des Re-Exports. Dass
 *    `OfflineKarte` auf `OfflineKarteAntwort` und nicht auf `OfflineKarte` zeigt, sichert der
 *    Typecheck an den ~30 Karten-Konsumenten, nicht dieser Test.
 *  - Er sieht nur `frontend/src/api/`. Eine Response-Form, die sich in eine Seiten-Komponente
 *    verirrt, ist unsichtbar — der API-Seam ist aber per Konvention der einzige Ort, an dem
 *    Response-Typen entstehen ("Komponenten importieren ausschließlich von hier").
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

/** Siehe STUFE 1 oben. Bewusst am ENDE des Namens bzw. am Anfang verankert — ein `…Filter`
 *  irgendwo in der Mitte (`FilterAnzeige`) soll nicht durchrutschen. */
const REQUEST_DTO_KONVENTION = /(Eingabe|Patch|Body|Filter|Update)$|^(Neuer|Neue|Neues|Patch)[A-Z]/;

/**
 * STUFE 2 — Schlüssel `<dateiname>#<Name>` → Begründung. Datei-qualifiziert, weil Namen
 * kollidieren (`AdhocEingabe`/`StatusEingabe` gibt es je zweimal).
 *
 * EIN EINTRAG IST EINE ENTSCHEIDUNG, KEIN FREIBRIEF: er behauptet, dass für diese Form KEIN
 * generiertes Schema existiert oder existieren kann. Wer hier etwas einträgt, das ein Rust
 * `ToSchema`-Gegenstück hat, hebelt den Codegen aus.
 */
const AUSNAHMEN: Record<string, string> = {
  // ── Scanner-/Guard-Infrastruktur: keine API-DTOs, nur zufällig in diesem Ordner. ──
  'apiTypScan.ts#ApiTypFund': 'Rückgabetyp dieses Scanners selbst — kein Wire-Typ.',
  'queryKeyScan.ts#Fund': 'Rückgabetyp des Query-Key-Scanners (LFH-312) — kein Wire-Typ.',

  // ── Request-/Eingabe-DTOs, die die Namenskonvention nicht treffen. ──
  'lagezonen.ts#ZoneNeu': 'POST-Body einer Lage-Zone (Wortstellung „Neu" hinten statt vorn).',
  'etb.ts#EtbFilterWerte': 'Formular-Werte der ETB-Filterleiste — reine Eingabeseite.',
  'etb.ts#EtbAbfrage': 'Query-Parameter der ETB-Abfrage (erweitert EtbFilterWerte).',
  'types.ts#FachebenenSichtbar':
    'FE-lokale Formgebung: Rust serialisiert `fachebenen_sichtbar` untypisiert (`unknown`), ' +
    'es gibt also kein Schema zum Re-Exportieren. Bereits in types.ts so dokumentiert (LFH-120).',

  // ── Durchreiche des externen karten-service (LFH-203). ──
  // Das Backend antwortet auf /bau-status und /baubare-regionen mit `Json<serde_json::Value>`
  // (verifiziert in `src/routes/karte.rs`) — es reicht die Antwort eines FREMDEN Dienstes roh
  // durch. Es gibt kein `ToSchema`-Struct und damit kein generiertes Schema; ein Re-Export ist
  // hier unmöglich, nicht bloß unbequem.
  'offlineKarten.ts#BauJobStatus': 'karten-service-Durchreiche (serde_json::Value) — kein Schema.',
  'offlineKarten.ts#BauJob': 'karten-service-Durchreiche (serde_json::Value) — kein Schema.',
  'offlineKarten.ts#BaubareRegion': 'karten-service-Durchreiche (serde_json::Value) — kein Schema.',

  // ── Response-Formen ohne Codegen-Gegenstück, jeweils mit dokumentiertem Grund. ──
  'auth.ts#MfaErforderlich':
    'Zweig einer `#[serde(untagged)]`-Union (`LoginAntwort`), bewusst NICHT im Typ-Codegen ' +
    'registriert — die Nicht-TOTP-Form bleibt byte-identisch `BenutzerAnzeige` (LFH-43).',
  'webauthn.ts#WebauthnCreationChallenge':
    'Hülle um `PublicKeyCredentialCreationOptionsJSON` aus @simplewebauthn/browser; das Backend ' +
    'serialisiert einen Fremdcrate-Typ (webauthn_rs) ohne ToSchema (LFH-275).',
  'webauthn.ts#WebauthnRequestChallenge':
    'Analog WebauthnCreationChallenge — Fremdcrate-Typ (webauthn_rs) ohne ToSchema (LFH-275).',
  'dev.ts#DevBenutzer':
    'Feature-gegateter Dev-Endpunkt (/api/dev/users); das Backend-DTO ist nicht in ApiDoc ' +
    'registriert, weil der Endpunkt in Release-Builds gar nicht existiert.',
};

/**
 * Die durch LFH-265 (Teil A) migrierten Response-Formen. Sie MÜSSEN Re-Exporte bleiben — dieser
 * Pin macht den erreichten Endstand explizit, statt ihn nur implizit aus „nicht auf der Liste"
 * folgen zu lassen. Er ist zugleich das Ziel der Mutationsprobe (siehe unten).
 */
const MIGRIERTE_RESPONSE_TYPEN = [
  'OnlineStyle', 'OfflineRegion', 'KarteServerConfig', // karte.ts
  'OfflineKarte', 'OfflineKatalogEintrag', 'VorhandeneKarte', // offlineKarten.ts
  'OnlineQuelle', // onlineQuellen.ts
  'FeatureCollection', 'FachebeneAntwort', // fachebenen.ts
  'Hintergrundbild', // kartenbilder.ts
  'Peilung', 'OrtVorschau', // ortVorschau.ts
] as const;

// Alle API-Seam-Quellen als Rohtext (Vite). Das Glob bleibt bewusst HIER und nicht im Scanner —
// sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im App-Bundle.
const dateien = import.meta.glob('/src/api/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function istAusgeschlossen(pfad: string): boolean {
  // Die generierte Datei ist die QUELLE der Re-Exporte und besteht selbst aus `export interface
  // paths/components/…`. Sie zu scannen hieße, den Codegen gegen sich selbst zu wenden.
  if (pfad.endsWith('/types.generated.ts')) return true;
  // Tests bauen Fixtures und pinnen Formen bewusst. `.typetest.ts` zählt mit (endet NICHT auf
  // `.test.ts` — vor „test" steht ein „e", kein Punkt) und wäre sonst mitgescannt.
  return /\.(type)?test\.ts$/.test(pfad);
}

const FUNDE: ApiTypFund[] = Object.entries(dateien)
  .filter(([pfad]) => !istAusgeschlossen(pfad))
  .flatMap(([pfad, inhalt]) => scanneApiTypen(pfad, inhalt));

const zeige = (f: ApiTypFund): string => `${f.pfad}:${f.zeile}  ${f.name} [${f.art}]`;

/**
 * LEERLAUF-SCHUTZ (Muster aus queryKeys.guard.test.ts). Der Hauptguard hat die Form „für jeden
 * Fund gilt …" und wäre über einer LEEREN Fundmenge trivial wahr. Ein kaputtes Glob, ein zu
 * breiter Ausschluss oder ein Scanner, der nichts mehr meldet, sähe dann wie ein grüner Lauf aus.
 */
describe('API-Response-Typen-Guard: der Scan läuft überhaupt', () => {
  it('scannt den API-Seam und findet exportierte Objekt-Typen', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(30);
    expect(FUNDE.length).toBeGreaterThan(50);
  });

  it('erkennt beide Formen (interface UND Objekt-Typ-Alias)', () => {
    // Ohne diesen Test könnte der `objekt-alias`-Zweig des Scanners still kaputtgehen und die
    // naheliegendste Umgehung (`export type X = { … }` statt `export interface X`) stünde offen.
    const probe = scanneApiTypen('probe.ts', [
      'export interface A { x: number }',
      'export type B = { y: string };',
      "export type C = S['Egal'];", // Re-Export — darf NICHT auffallen
      'type D = { z: boolean };', // nicht exportiert — darf NICHT auffallen
    ].join('\n'));
    expect(probe.map((f) => `${f.name}:${f.art}`)).toEqual(['A:interface', 'B:objekt-alias']);
  });
});

describe('API-Response-Typen-Guard: keine handgerollten Response-Formen', () => {
  it('jeder exportierte Objekt-Typ ist Request-DTO (Konvention) oder begründete Ausnahme', () => {
    const verstoesse = FUNDE.filter(
      (f) => !REQUEST_DTO_KONVENTION.test(f.name) && !(f.schluessel in AUSNAHMEN),
    ).map((f) => `${zeige(f)}  → Schlüssel '${f.schluessel}'`);
    expect(
      verstoesse,
      'Handgerollte Objekt-Typen im API-Seam gefunden. Response-Formen gehören als Re-Export ' +
        "über `components['schemas'][…]` aus types.generated.ts (Muster: api/types.ts) — sonst " +
        'driftet der Typ still gegen das Backend. Ist es ein Request-/Eingabe-DTO, folge der ' +
        'Namenskonvention (…Eingabe/…Patch/…Body/…Filter/…Update, Neuer…/Neue…/Neues…) oder ' +
        `trage es MIT Begründung in AUSNAHMEN ein:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it(`hält die ${MIGRIERTE_RESPONSE_TYPEN.length} LFH-265-Response-Typen als Re-Export`, () => {
    const namen = new Set(FUNDE.map((f) => f.name));
    const rueckfaelle = MIGRIERTE_RESPONSE_TYPEN.filter((n) => namen.has(n));
    expect(
      rueckfaelle,
      'Diese Response-Typen wurden in LFH-265 auf Re-Exporte umgestellt und sind wieder von ' +
        `Hand geschrieben:\n${rueckfaelle.join('\n')}`,
    ).toEqual([]);
  });
});

describe('API-Response-Typen-Guard: die Ausnahmeliste bleibt ehrlich', () => {
  it('STALE-CHECK: jeder Ausnahme-Eintrag hat noch eine Fundstelle', () => {
    const vorhanden = new Set(FUNDE.map((f) => f.schluessel));
    const leichen = Object.keys(AUSNAHMEN).filter((k) => !vorhanden.has(k));
    expect(
      leichen,
      `Ausnahme-Leichen: diese Schlüssel haben keine Fundstelle mehr und gehören gelöscht ` +
        `(sonst deckt die Liste eine Datei, die es nicht mehr gibt):\n${leichen.join('\n')}`,
    ).toEqual([]);
  });

  it('enthält keinen Eintrag, den schon die Konvention trägt', () => {
    // Ein doppelt abgedeckter Eintrag ist harmlos, aber irreführend: er suggeriert eine
    // Entscheidung, wo die Konvention längst greift — und überlebt so das Löschen der Form.
    const redundant = Object.keys(AUSNAHMEN).filter((k) =>
      REQUEST_DTO_KONVENTION.test(k.split('#')[1]),
    );
    expect(redundant).toEqual([]);
  });

  it('jeder Eintrag trägt eine echte Begründung (kein Platzhalter)', () => {
    // Ohne diesen Test wäre `'…': ''` ein gültiger Freikauf und die Beweislast der Stufe 2 wäre
    // still weg. Schwelle bewusst niedrig — geprüft wird Vorhandensein, nicht Qualität.
    const duenn = Object.entries(AUSNAHMEN)
      .filter(([, grund]) => grund.trim().length < 20)
      .map(([k]) => k);
    expect(duenn).toEqual([]);
  });
});
