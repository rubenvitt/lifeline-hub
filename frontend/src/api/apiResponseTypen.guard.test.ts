import { describe, expect, it } from 'vitest';
import { scanneApiTypen, type ApiTypFund } from './apiTypScan';

/**
 * Guard (LFH-265): im API-Seam werden Response-Formen NICHT von Hand beschrieben. Eine
 * handgerollte Response-Form driftet still gegen das Backend (der Client liest ein Feld, das es
 * nicht mehr gibt); der Typ-Codegen ist die Gegenmaßnahme.
 *
 * Mechanik wie `queryKeys.guard.test.ts`: TS-AST, das Glob bleibt im Guard-Test. Erfasste Formen
 * und die Grenzen des Scanners stehen im Kopf von `apiTypScan.ts`.
 *
 * ZWEISTUFIGE, PERMANENTE ERLAUBNIS (Request-DTOs bleiben handgerollt):
 *  STUFE 1: Namenskonvention ({@link REQUEST_DTO_KONVENTION}): `…Eingabe`, `…Patch`, `…Body`,
 *    `…Filter`, `…Update`, `Neuer…`/`Neue…`/`Neues…`/`Patch…`. Trägt, weil Response-Typen die
 *    Namen ihrer Rust-Gegenstücke erben (`…Anzeige`, `…Antwort`, `…Detail`).
 *  STUFE 2: benannte Ausnahmen ({@link AUSNAHMEN}) MIT Begründung; ein Stale-Check hält die
 *    Liste frei von Leichen.
 *
 * NICHT geleistet: die RICHTIGKEIT eines Re-Exports (das sichert der Typecheck der
 * Konsumenten), und nur `frontend/src/api/` wird gesehen.
 */

/** Siehe STUFE 1 oben. Am ENDE bzw. am Anfang verankert, damit `FilterAnzeige` nicht
 *  durchrutscht. */
const REQUEST_DTO_KONVENTION = /(Eingabe|Patch|Body|Filter|Update)$|^(Neuer|Neue|Neues|Patch)[A-Z]/;

/**
 * STUFE 2: Schlüssel `<dateiname>#<Name>` → Begründung, datei-qualifiziert, weil Namen
 * kollidieren. Ein Eintrag behauptet, dass für diese Form KEIN generiertes Schema existiert;
 * wer etwas mit `ToSchema`-Gegenstück einträgt, hebelt den Codegen aus.
 */
const AUSNAHMEN: Record<string, string> = {
  // ── Scanner-/Guard-Infrastruktur: keine API-DTOs, nur zufällig in diesem Ordner. ──
  'apiTypScan.ts#ApiTypFund': 'Rückgabetyp dieses Scanners selbst — kein Wire-Typ.',
  'queryKeyScan.ts#Fund': 'Rückgabetyp des Query-Key-Scanners (LFH-312) — kein Wire-Typ.',
  'client.ts#ApiSendOptionen':
    'FE-lokale Transportoptionen für Request-Header — weder Request- noch Response-Wire-DTO.',
  'client.ts#UploadOptionen':
    'FE-lokale Transportoptionen für Datei-Uploads (Timeout, LFH-632) — weder Request- noch ' +
    'Response-Wire-DTO.',
  'client.ts#UploadMitFortschrittOptionen':
    'FE-lokale Transportoptionen des Uploads mit Fortschritt (Timeout, Rückruf, LFH-654) — ' +
    'weder Request- noch Response-Wire-DTO.',

  // ── Request-/Eingabe-DTOs, die die Namenskonvention nicht treffen. ──
  'lagezonen.ts#ZoneNeu': 'POST-Body einer Lage-Zone (Wortstellung „Neu" hinten statt vorn).',
  'dokumente.ts#DokumentAblage':
    'Multipart-Eingabe-DTO fürs Ablegen eines Dokuments (Datei + Metadaten, LFH-632) — der ' +
    'Wortstamm „Ablage" trifft die Namenskonvention nicht.',
  'etb.ts#EtbFilterWerte': 'Formular-Werte der ETB-Filterleiste — reine Eingabeseite.',
  'etb.ts#EtbAbfrage': 'Query-Parameter der ETB-Abfrage (erweitert EtbFilterWerte).',
  'types.ts#FachebenenSichtbar':
    'FE-lokale Formgebung: Rust serialisiert `fachebenen_sichtbar` untypisiert (`unknown`), ' +
    'es gibt also kein Schema zum Re-Exportieren. Bereits in types.ts so dokumentiert (LFH-120).',

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
 * Migrierte Response-Formen: sie MÜSSEN Re-Exporte bleiben. Der Pin macht den Endstand
 * explizit, statt ihn nur aus „nicht auf der Liste“ folgen zu lassen.
 */
const MIGRIERTE_RESPONSE_TYPEN = [
  'OnlineStyle',
  'OfflineRegion',
  'KarteServerConfig', // karte.ts
  'OfflineKarte',
  'OfflineKatalogEintrag',
  'VorhandeneKarte', // offlineKarten.ts
  'BauJob',
  'BauJobStatus',
  'BaubareRegion', // offlineKarten.ts (karten-service-Kontrakt)
  'OnlineQuelle', // onlineQuellen.ts
  'FeatureCollection',
  'FachebeneAntwort', // fachebenen.ts
  'Hintergrundbild', // kartenbilder.ts
  'Peilung',
  'OrtVorschau', // ortVorschau.ts
] as const;

// Das Glob bleibt bewusst HIER und nicht im Scanner, sonst landete bei einem versehentlichen
// Produktiv-Import der Quelltext im App-Bundle.
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
  // `.test.ts`).
  return /\.(type)?test\.ts$/.test(pfad);
}

const FUNDE: ApiTypFund[] = Object.entries(dateien)
  .filter(([pfad]) => !istAusgeschlossen(pfad))
  .flatMap(([pfad, inhalt]) => scanneApiTypen(pfad, inhalt));

const zeige = (f: ApiTypFund): string => `${f.pfad}:${f.zeile}  ${f.name} [${f.art}]`;

/**
 * LEERLAUF-SCHUTZ: der Hauptguard („für jeden Fund gilt …“) wäre über einer LEEREN Fundmenge
 * trivial wahr.
 */
describe('API-Response-Typen-Guard: der Scan läuft überhaupt', () => {
  it('scannt den API-Seam und findet exportierte Objekt-Typen', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(30);
    expect(FUNDE.length).toBeGreaterThan(50);
  });

  it('erkennt beide Formen (interface UND Objekt-Typ-Alias)', () => {
    // Hält den `objekt-alias`-Zweig lebendig; sonst stünde `export type X = { … }` als Umgehung
    // offen.
    const probe = scanneApiTypen(
      'probe.ts',
      [
        'export interface A { x: number }',
        'export type B = { y: string };',
        "export type C = S['Egal'];", // Re-Export — darf NICHT auffallen
        'type D = { z: boolean };', // nicht exportiert — darf NICHT auffallen
      ].join('\n'),
    );
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
    // Ein doppelt abgedeckter Eintrag suggeriert eine Entscheidung, wo die Konvention greift, und
    // überlebt so das Löschen der Form.
    const redundant = Object.keys(AUSNAHMEN).filter((k) =>
      REQUEST_DTO_KONVENTION.test(k.split('#')[1]),
    );
    expect(redundant).toEqual([]);
  });

  it('jeder Eintrag trägt eine echte Begründung (kein Platzhalter)', () => {
    // Ohne diesen Test wäre `'…': ''` ein gültiger Freikauf. Geprüft wird Vorhandensein, nicht
    // Qualität.
    const duenn = Object.entries(AUSNAHMEN)
      .filter(([, grund]) => grund.trim().length < 20)
      .map(([k]) => k);
    expect(duenn).toEqual([]);
  });
});
