# Hilfe mit Kontext — Implementation Plan (LLH-1824)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** „?“ im Kopf, die Tasten ?/F1 und zwei Palettenbefehle öffnen eine Hilfe-Seitenleiste mit dem Kapitel zur aktuellen Seite und einer Tastenkürzel-Übersicht; eine Willkommenskarte führt Erstnutzer heran.

**Architecture:** Ein kleiner Provider im Haupt-Chunk (`hilfe/HilfeSeitenleisteProvider.tsx`) hält Zustand, Tasten und `oeffneHilfe`; der Drawer mit den Kapiteltexten (`hilfe/HilfeSeitenleiste.tsx`) kommt per `lazy` aus dem Hilfe-Chunk. Die Zuordnung Seite → Kapitel liegt als Feld `hilfeKapitel` an der Modul-Registry plus Pfadtabelle in `hilfe/kontextKapitel.ts` (ohne Texte). Die Willkommenskarte merkt sich das Schließen im Benutzer-Einstellungsfach (neuer Schlüssel).

**Tech Stack:** React 19, react-router, antd 6, TanStack Query, Vitest + Testing Library; Rust/axum (ein Whitelist-Eintrag).

**Spec:** `docs/superpowers/specs/2026-11-19-col12d3y-hilfe-mit-kontext-design.md`

## Global Constraints

- Kapiteltexte nie im Haupt-Chunk: `kontextKapitel.ts`, `tastenkuerzel.ts`, `HilfeSeitenleisteProvider.tsx`, `WillkommenKarte.tsx` und `command-palette/befehle.ts` importieren `hilfe/kapitel.ts` nicht (auch nicht transitiv über `HilfePage`).
- Reiter als `Segmentleiste rolle="tablist"` (ADR-0061), nie antd-`Tabs`.
- Zeigerart nur über `useViewport().istBeruehrung`, nie über die Breite.
- Drawer-Breite 480 px; unter `lg` oder bei Berührung volle Breite.
- Anrede unpersönlich (LLH-1812). Texte: „Hilfe zu dieser Seite“, „Tastenkürzel“, „Zu dieser Seite“, „In der Hilfe öffnen“, „Alle Kapitel“, „Hilfe ist gerade nicht verfügbar“, „Willkommen bei Lifeline Hub“, „Einweisung lesen“, „Verstanden“.
- Kein Auslösen auf dem gekoppelten Gerät, unter `/hilfe…`, unter dem Gerätepfad oder ohne angemeldeten Benutzer.
- Bezeichner: Fachwörter deutsch, Technik englisch (`AGENTS.md`, LFH-1312): `oeffneHilfe` ist Bestand-nah, neue Technikwörter englisch (`isOffen` nicht, `offen` als Zustand bleibt Fachwort der Oberfläche).
- Prosa, Testbeschreibungen, Commits deutsch; Commit-Body mit `Zunder: https://zunder.rubeen.dev/#/aufgabe/col12d3ymod85y66w5kv5huv`.

## Review Focus

1. „?“ wird in einer Eingabe getippt (ETB-Text, Suchfeld, contenteditable des Markdown-Editors) → muss Text bleiben. Test in Task 4.
2. Leiste offen, Route wechselt (Modulwechsel, Wechsel Einsatzliste → Einsatz) → Inhalt folgt, Leiste bleibt offen, kein Absturz bei unbekanntem Pfad (Rückfall `einsatz-oberflaeche`). Tests in Task 2 und 5.
3. Sprungpalette oder ein Modal ist offen, jemand drückt „?“ → nichts passiert. Test in Task 4.
4. Willkommen-Stand lädt noch oder Abruf scheitert → keine Karte; Schließen scheitert am Server → Karte verschwindet trotzdem für diese Sitzung, kein Fehlerdialog. Tests in Task 7.
5. Kapitel-Link im Text der Leiste („[…](ohne-netz.md)“) → öffnet die volle Hilfe und schließt die Leiste, statt ins Leere zu führen. Test in Task 5.

---

### Task 1: Schlüssel `willkommen_geschlossen` im Benutzer-Einstellungsfach

**Files:**
- Modify: `src/benutzer_einstellungen/mod.rs` (Konstante + `BEKANNTE_SCHLUESSEL` + Test)

**Interfaces:**
- Produces: Wire-Schlüssel `'willkommen_geschlossen'`, Wert = UTC-Zeitpunkt `%Y-%m-%d %H:%M:%S` als Text (opak, nicht geprüft).

- [x] **Step 1:** Test `willkommen_geschlossen_ist_ein_gueltiger_opaker_schluessel` neben dem Schnellaktionen-Test: `assert!(ist_gueltiger_schluessel("willkommen_geschlossen"))` und `pruefe_wert("willkommen_geschlossen", "2026-11-19 09:00:00")` liefert den Wert unverändert.
- [x] **Step 2:** `cargo test --lib benutzer_einstellungen` → FAIL.
- [x] **Step 3:** `pub const SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN: &str = "willkommen_geschlossen";` mit Doc-Kommentar (LLH-1824, Client-Leser `hilfe/WillkommenKarte.tsx`), in `BEKANNTE_SCHLUESSEL` aufnehmen.
- [x] **Step 4:** `cargo test --lib benutzer_einstellungen` → PASS.
- [x] **Step 5:** Commit `feat(benutzer-einstellungen): Schlüssel willkommen_geschlossen`.

### Task 2: Zuordnung Seite → Kapitel

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts` (Pflichtfeld `hilfeKapitel` in `ModulEintrag`, Wert je Eintrag)
- Create: `frontend/src/hilfe/kontextKapitel.ts`
- Create: `frontend/src/hilfe/kontextKapitel.test.ts`, `frontend/src/hilfe/kontextKapitel.guard.test.ts`
- Modify: Test-Fixtures, die `ModulEintrag` von Hand bauen (per `tsc` finden)

**Interfaces:**
- Produces: `ModulEintrag.hilfeKapitel: string`; `RUECKFALL_KAPITEL = 'einsatz-oberflaeche'`; `KAPITEL_JE_PFAD: readonly { muster: string; kapitel: string }[]`; `kapitelFuerPfad(pfad: string): string`.

Zuordnung der Module (aus den `quellen` der Kapitel): ueberblick→`ueberblick`, etb→`einsatztagebuch`, einsatzdaten→`einsatzdaten`, einsatzabschnitte→`einsatzabschnitte`, auftraege→`auftraege-befehle`, lagebesprechung→`lagebesprechung`, dokumente→`dokumente`, kraefteuebersicht→`meldebild`, einheiten→`einheiten`, personal→`personal`, fahrzeuge→`fahrzeuge`, material→`material`, verpflegung→`verpflegung`, bereitstellungsraeume→`bereitstellungsraeume`, nachforderungen→`nachforderung`, abloesung→`abloesung`, personen→`betroffene`, unfallhilfsstellen→`unfallhilfsstellen`, evakuierung→`evakuierung`, betreuung→`betreuung`, tiere→`tiere`, schaeden→`schaeden`, lage-dashboard→`lagebild`, lagekarte→`lagekarte`, lageberichte→`lageberichte`, gefahrenzonen→`gefahren`, wetter-pegel→`wetter-pegel`, lagemeldungen→`lagemeldungen`, chat→`chat`, erinnerungen→`erinnerungen`, meldungen→`meldungen`, fernmeldewesen→`funkplan`, infotelefon→`infotelefon`, einsatz-einstellungen→`einsatz-einstellungen`.

Pfadtabelle (Muster mit `*` = beliebiger Rest, `:id` = ein Segment; erste passende gewinnt, vor der Registry): `/einsaetze/:id/einstellungen/geraete*`→`geraete-koppeln`, `/einsaetze/:id/einstellungen/anbindungen*`→`externe-lagemonitore`, `/einsaetze/:id/einstellungen/lagebild-extern*`→`lagebild-extern`, `/einsaetze`→`einsatz-oberflaeche`, `/neuigkeiten`→`neuigkeiten`, `/planungen*`→`vorplanung`, `/profil`→`profil-sicherheit`, `/benachrichtigungen`→`einsatz-oberflaeche`, `/admin/benutzer*`→`benutzer`, `/admin/stammdaten*`→`stammdaten`, `/admin/demo-daten`→`demo-daten`, `/admin/aufbewahrung*`→`aufbewahrung`, `/admin/zugangsprotokoll`→`zugangsprotokoll`, `/admin/einstellungen/anbindungen*`→`anbindungen`, `/admin*`→`verwaltung`. Die Einstellungs-Unterpfade vorher in `App.tsx`/`EinsatzEinstellungenPage.tsx` gegenprüfen; weitere Admin-Sektionen (Karten, Instanzkopplung) aus `admin/adminNav.tsx` ergänzen.

- [x] **Step 1:** `kontextKapitel.test.ts`: `kapitelFuerPfad('/einsaetze/5/etb')` → `'einsatztagebuch'`; `'/einsaetze/5/etb/12'` → `'einsatztagebuch'`; `'/einsaetze/5/stab/funkplan'` → `'funkplan'` (Altpfad über `modulAusPfad`); `'/einsaetze/5/einstellungen/geraete'` → `'geraete-koppeln'`; `'/einsaetze/5/einstellungen'` → `'einsatz-einstellungen'`; `'/einsaetze'` → `'einsatz-oberflaeche'`; `'/admin/stammdaten/personal/3'` → `'stammdaten'`; `'/admin'` → `'verwaltung'`; `'/gibtsnicht'` → `'einsatz-oberflaeche'`; `'/einsaetze/5/unbekannt'` → `'einsatz-oberflaeche'`.
- [x] **Step 2:** `kontextKapitel.guard.test.ts`: für jedes `modulRegistry`-Element und jeden `KAPITEL_JE_PFAD`-Eintrag ist das Kapitel in `KAPITEL.map(k => k.slug)` (Import aus `./kapitel` ist im Test erlaubt).
- [x] **Step 3:** `mise exec -- pnpm -C frontend exec vitest run src/hilfe/kontextKapitel` → FAIL.
- [x] **Step 4:** Feld `hilfeKapitel` (Doc-Kommentar: Slug unter `docs/anwender/kapitel/`, LLH-1824) und Werte eintragen; `kontextKapitel.ts` mit Musterabgleich implementieren (Muster in Segmente zerlegen, `:id` passt auf ein Segment, abschließendes `*` auf beliebigen Rest inkl. leer), danach `modulAusPfad(pfad)?.hilfeKapitel`, sonst Rückfall. Kein Import von `./kapitel`.
- [x] **Step 5:** Tests aus Step 3 → PASS; `mise exec -- pnpm -C frontend exec tsc -b` → keine Fehler (Fixtures nachziehen).
- [x] **Step 6:** Commit `feat(hilfe): Kapitel je Seite über Modul-Registry und Pfadtabelle`.

### Task 3: Tastenkürzel-Tabelle

**Files:**
- Create: `frontend/src/hilfe/tastenkuerzel.ts`, `frontend/src/hilfe/tastenkuerzel.test.ts`

**Interfaces:**
- Consumes: `TASTATUR_AKTIONEN`, `TASTATUR_AKTION_REIHENFOLGE`, `kuerzelFuerTastaturAktion` (Export aus `command-palette/befehle.ts` prüfen; fehlt einer, exportieren).
- Produces: `interface KuerzelEintrag { tasten: string[]; wirkung: string }`, `interface KuerzelGruppe { titel: string; modulKey?: string; eintraege: KuerzelEintrag[] }`, `kuerzelGruppen(apple: boolean, aktuellerModulKey: string | null): KuerzelGruppe[]` — Modulgruppe der aktuellen Seite zuerst, dann „Überall“, „In der Sprungpalette“, „In Listen“, dann übrige Modulgruppen.

Inhalt: „Überall“: Sprungpalette (⌘K / Strg+K), Hilfe zu dieser Seite (?, F1), dazu je `TASTATUR_AKTION_REIHENFOLGE`-Eintrag mit Kürzel (Label aus `TASTATUR_AKTIONEN`). „In der Sprungpalette“: ↵ öffnen, ⌘↵/Strg+↵ im neuen Tab, → Vorschau, Esc zurück. „In Listen“: / Suchfeld. Modulgruppen: aus den `keydown`-Handlern sammeln (`pages/LagekartePage.tsx`, `pages/lagekarte/Kartenflaeche.tsx`, `pages/lagekarte/Werkzeugmenue.tsx`, `pages/lagekarte/useAbschnittFokus.ts`, `abloesung/schichtplan/SchichtplanRaster.tsx`, `etb/Schnellerfassung.tsx`, `components/Erfassung.tsx`); nur Kürzel aufnehmen, die dort tatsächlich ausgewertet werden, mit `modulKey` des Moduls.

- [x] **Step 1:** Tests: (a) jede `TastaturAktionId` mit Kürzel steht als `wirkung` gleich `TASTATUR_AKTIONEN[id].label` in „Überall“; (b) `kuerzelGruppen(true, null)` enthält `['⌘', 'K']`-Form (genau die Form, die `kuerzelFuerTastaturAktion` für Apple liefert, wiederverwenden), `false` die Strg-Form; (c) `kuerzelGruppen(false, 'lagekarte')[0].modulKey === 'lagekarte'`; (d) kein Gruppe ohne Einträge.
- [x] **Step 2:** `vitest run src/hilfe/tastenkuerzel` → FAIL.
- [x] **Step 3:** Implementieren, ohne Import von `./kapitel`.
- [x] **Step 4:** → PASS.
- [x] **Step 5:** Commit `feat(hilfe): Tabelle der Tastenkürzel`.

### Task 4: Provider, Tasten und Einbau in `App.tsx`

**Files:**
- Create: `frontend/src/hilfe/HilfeSeitenleisteProvider.tsx`, `frontend/src/hilfe/HilfeSeitenleisteProvider.test.tsx`
- Modify: `frontend/src/App.tsx` (Provider zwischen `AuthProvider` und `CommandPaletteProvider`)

**Interfaces:**
- Produces: `type HilfeReiter = 'seite' | 'kuerzel'`; `useHilfeSeitenleiste(): { oeffneHilfe?: (reiter?: HilfeReiter) => void; offen: boolean; reiter: HilfeReiter; schliesse: () => void; setzeReiter: (r: HilfeReiter) => void }` (ohne Provider: alles inaktiv, kein Wurf — Tests und Gerätehülle); `istHilfeAktiv(pfad: string, auth: { benutzer: unknown; geraet: unknown } | null): boolean`; `istTasteFuerHilfe(e: KeyboardEvent): boolean`.
- Consumes: Task 2 nicht direkt; die Leiste (Task 5) wird hier per `lazy(() => import('./HilfeSeitenleiste'))` gerendert, nur wenn je einmal geöffnet.

Regeln: aktiv nur mit `benutzer`, ohne `geraet`, Pfad nicht `/hilfe…`, nicht `GERAET_START_PFAD…`, nicht `/login`. Taste: `defaultPrevented`/`repeat`/`isComposing` → nein; `?` ohne Strg/⌘/Alt (Umschalt erlaubt) → ja, außer Ziel ist `input`/`textarea`/`select`/`[contenteditable]` (über `closest`); `F1` ohne Modifikator → ja, auch in Eingaben, mit `preventDefault`. Bei sichtbarem `[aria-modal="true"]`, das nicht die eigene Leiste ist (`data-lfh="hilfe-seitenleiste"`), nichts tun (deckt die offene Palette mit ab — prüfen, dass die Palette `aria-modal` trägt; sonst zusätzlich `[data-lfh]` der Palette prüfen). Ist die Leiste offen, schließt die Taste sie. Schließen gibt den Fokus an das vorher fokussierte Element zurück.

- [x] **Step 1:** Tests (mit `MemoryRouter`, Auth-Attrappe wie in bestehenden Provider-Tests): „?“ auf `document.body` öffnet (Leisten-Stub per `vi.mock('./HilfeSeitenleiste')`); „?“ in `<input>`, `<textarea>`, `<div contenteditable>` öffnet nicht; F1 in `<input>` öffnet und `defaultPrevented === true`; Strg+? öffnet nicht; mit `<div aria-modal="true">` im DOM öffnet nicht; zweites „?“ schließt; unter `/hilfe/lagekarte` und für `geraet` ist `oeffneHilfe` undefined und „?“ wirkt nicht; `istHilfeAktiv` als reine Fälle.
- [x] **Step 2:** `vitest run src/hilfe/HilfeSeitenleisteProvider` → FAIL.
- [x] **Step 3:** Implementieren; in `App.tsx` einbauen.
- [x] **Step 4:** → PASS; `vitest run src/App` und Palette-Tests (`src/command-palette`) grün.
- [x] **Step 5:** Commit `feat(hilfe): Seitenleisten-Provider mit Tasten ? und F1`.

### Task 5: Die Seitenleiste

**Files:**
- Create: `frontend/src/hilfe/HilfeSeitenleiste.tsx`, `frontend/src/hilfe/HilfeSeitenleiste.test.tsx`
- Modify: `frontend/src/hilfe/Hilfe.css` (nur falls Abstände der Leiste nötig; Klassen `hilfe-seitenleiste__…`)

**Interfaces:**
- Consumes: `useHilfeSeitenleiste` (Task 4), `kapitelFuerPfad` (Task 2), `kuerzelGruppen` (Task 3), `findeKapitel`, `verlinke` (`hilfe/kapitel.ts`), `Markdown`, `HilfeBild`, `Segmentleiste`, `Tastenkuerzel`, `hilfePfad`, `useViewport`, `istApplePlattform`, `modulAusPfad`.
- Produces: `export default function HilfeSeitenleiste(): JSX.Element` (liest alles aus dem Kontext).

Aufbau: antd-`Drawer` `placement="right"`, `size` 480 bzw. `'100%'` unter `lg`/bei Berührung, `destroyOnHidden`, `rootClassName`/`data-lfh="hilfe-seitenleiste"`, Titel = Kapiteltitel. Unter dem Titel `Segmentleiste rolle="tablist"` „Zu dieser Seite | Tastenkürzel“ — fehlt bei Berührung. Reiter „seite“: `<Markdown unterEbene={1} bild={HilfeBild}>{verlinke(text, s => hilfePfad({ kapitel: s }))}</Markdown>`; Klick auf einen Link `/hilfe…` im Text: `preventDefault`, `schliesse()`, `navigate(ziel, { state: { von: location.pathname } })`. Fuß: „In der Hilfe öffnen“ (`hilfePfad({ kapitel, von })`; ab `lg` ohne Berührung `target="_blank" rel="noopener"`, sonst Navigation mit `state.von`) und „Alle Kapitel“ (`hilfePfad()`). Reiter „kuerzel“: je Gruppe `<h3>` + `<dl>` mit `Tastenkuerzel`-Marken. Rollposition beim Kapitelwechsel nach oben. Fehlt das Kapitel (darf nach dem Wächter nicht passieren): Rückfall-Kapitel.

Lade- und Fehlerzustand gehören in den Provider (Task 4 rendert `<Suspense fallback={<Drawer open …><Skeleton /></Drawer>}>` und eine kleine Fehlergrenze mit „Hilfe ist gerade nicht verfügbar“ + Link `hilfePfad()`); hier ergänzen und testen.

- [x] **Step 1:** Tests: unter `/einsaetze/5/lagekarte` zeigt die Leiste den Titel des Kapitels `lagekarte` (Titel aus `findeKapitel('lagekarte')`); Routenwechsel auf `/einsaetze/5/etb` bei offener Leiste → Titel von `einsatztagebuch`, Leiste weiter offen; Reiter „Tastenkürzel“ zeigt „Sprungpalette“; mit `istBeruehrung` keine `tablist`; Klick auf einen Kapitel-Link im Text navigiert nach `/hilfe/<slug>` und schließt; Esc schließt und der Fokus liegt wieder auf dem Auslöser-Knopf; ein Wurf beim Laden (`vi.mock` wirft) zeigt „Hilfe ist gerade nicht verfügbar“.
- [x] **Step 2:** → FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** → PASS.
- [x] **Step 5:** Commit `feat(hilfe): Seitenleiste mit Kapitel zur Seite und Tastenkürzeln`.

### Task 6: Knopf „?“ im Kopf

**Files:**
- Create: `frontend/src/hilfe/HilfeKnopf.tsx`, `frontend/src/hilfe/HilfeKnopf.test.tsx`
- Modify: `frontend/src/components/AppLayout.tsx` (Zelle links vom `BenutzerMenu`), `frontend/src/einsatz/EinsatzLayout.tsx` (ab `mittel` links vom `BenutzerMenu`; unter `mittel` im Fuß des Navigations-Drawers als Knopf „Hilfe zu dieser Seite“ über dem `BenutzerMenu`)

**Interfaces:**
- Consumes: `useHilfeSeitenleiste`.
- Produces: `HilfeKnopf({ beschriftet?: boolean })` — ohne `oeffneHilfe` rendert er `null`; `beschriftet` zeigt Text statt nur Symbol (Drawer-Fuß).

Bedienziel nach Kopf-Mustern (`kopfZelleStil`, Maße wie Nachbarn, Farbe erbt `--lfh-kopf-vordergrund`), Symbol aus dem Icon-Satz (Fragezeichen; falls keins vorhanden, Muster für neue Icons in `frontend/AGENTS.md` befolgen), `aria-label="Hilfe zu dieser Seite"`, `aria-keyshortcuts="? F1"`, Tooltip ohne Berührung „Hilfe zu dieser Seite (?)“. Im Navigations-Drawer: Klick schließt erst den Drawer, dann öffnet die Hilfe.

- [x] **Step 1:** Tests: Knopf da und öffnet; ohne Provider `null`; im Kopf von `AppLayout` und `EinsatzLayout` (bestehende Layout-Tests erweitern) per `getByRole('button', { name: 'Hilfe zu dieser Seite' })` auffindbar.
- [x] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS, dazu `vitest run src/einsatz/EinsatzLayout src/components/AppLayout` grün.
- [x] **Step 5:** Bild bei 360 px Breite (App-Rahmen) prüfen (Wegwerf-Spec wie unter „Bilder der Änderung“); passt der Knopf nicht, im App-Rahmen unter `md` stattdessen Menüeintrag „Hilfe zu dieser Seite“ im `BenutzerMenu` (Prop `hilfeZurSeite`).
- [x] **Step 6:** Commit `feat(hilfe): Knopf „?“ im Kopf`.

### Task 7: Sprungpalette

**Files:**
- Modify: `frontend/src/command-palette/typen.ts` (`BefehlKontext.oeffneHilfe?: (reiter?: 'seite' | 'kuerzel') => void`, `istBeruehrung?: boolean` falls nicht vorhanden), `frontend/src/command-palette/befehle.ts` (zwei Zeilen nach `nav:hilfe`), `frontend/src/command-palette/useBefehle.ts` (aus `useHilfeSeitenleiste` und `useViewport` füllen)
- Test: `frontend/src/command-palette/befehle.test.ts`

**Interfaces:**
- Produces: Befehle `hilfe:seite` („Hilfe zu dieser Seite“, Gruppe `navigation`, Icon `IconDokumente`, Schlagworte `['Hilfe', 'Anleitung', 'Doku', 'F1', '?']`, `ausfuehren: () => k.oeffneHilfe!('seite')`) und `hilfe:kuerzel` („Tastenkürzel“, Schlagworte `['Tasten', 'Kürzel', 'Shortcuts', 'Tastatur']`, nur ohne Berührung). Beide nur mit `k.oeffneHilfe` und `k.benutzer`. Der Typ `HilfeReiter` wird in `typen.ts` nicht aus `hilfe/` importiert, sondern als Literal geführt (kein Zyklus).

- [x] **Step 1:** Tests: mit `oeffneHilfe`-Spy beide Zeilen da, `ausfuehren` ruft `'seite'` bzw. `'kuerzel'`; ohne `oeffneHilfe` keine; mit `istBeruehrung: true` nur `hilfe:seite`; Suche „hilfe“ findet `hilfe:seite` vor „Unfallhilfsstelle anlegen“ (über die bestehende Trefferfunktion). Bestehende Guards (`befehle.test.ts` Navigationszeilen nur über `sprungZu`) dürfen die Aktionszeilen nicht treffen — Ausnahme dort sauber eintragen, falls nötig.
- [x] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** `vitest run src/command-palette` → PASS.
- [x] **Step 5:** Commit `feat(sprungpalette): Hilfe zu dieser Seite und Tastenkürzel`.

### Task 8: Willkommenskarte

**Files:**
- Create: `frontend/src/hilfe/willkommen.ts` (`SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN = 'willkommen_geschlossen'`, `istWillkommenOffen(stand: BenutzerEinstellungen | undefined): boolean`), `frontend/src/hilfe/WillkommenKarte.tsx`, `frontend/src/hilfe/WillkommenKarte.test.tsx`
- Modify: `frontend/src/pages/EinsaetzePage.tsx` (Karte direkt vor `<NeuigkeitenHinweis />`)

**Interfaces:**
- Consumes: `ladeBenutzerEinstellungen`, `setzeBenutzerEinstellung`, `globalKeys.benutzerEinstellungenVon`, `useAuthOptional`, `useViewport`, `hilfePfad`, Zeitformat UTC aus `anzeige/` bzw. dem bestehenden Wire-Formatierer (ADR-0012; nicht selbst `toISOString` zerschneiden, falls es einen Helfer gibt).

Verhalten: gleicher Query-Schlüssel wie `useSchnellaktionZaehler` (`staleTime: Infinity`). Sichtbar nur, wenn `data` geladen ist und `eintraege.willkommen_geschlossen` fehlt; nicht auf dem Gerät. Schließen („×“ und „Verstanden“): sofort lokal ausblenden (Zustand), dann `setzeBenutzerEinstellung` und mit der Antwort den Cache setzen; ein Fehler bleibt still. Inhalt: Titel „Willkommen bei Lifeline Hub“; drei Zeilen — Aufbau (Einsatzliste → Einsatz → Module), „?“ (mit `Tastenkuerzel`) öffnet die Hilfe zur aktuellen Seite, ⌘K/Strg+K öffnet die Sprungpalette (bei Berührung: „Die Suche im Kopf findet jedes Modul und jeden Einsatz“); Link „Einweisung lesen“ → `hilfePfad({ gruppe: 'alle' })`. Form nach dem Muster `neuigkeiten/HinweisKarte.tsx` (gleiche Karte, gleiche Abstände).

- [x] **Step 1:** Tests: ohne Schlüssel sichtbar; mit Schlüssel nicht; während des Ladens nicht; bei Abruffehler nicht; „Verstanden“ ruft PUT `/api/benutzer-einstellungen/willkommen_geschlossen` mit einem Wert im Muster `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` und blendet aus; PUT-Fehler → trotzdem ausgeblendet, kein Fehlertext; als Gerät nicht sichtbar; der Link zeigt auf `/hilfe?gruppe=alle` (genaue Form aus `hilfePfad`).
- [x] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS, `vitest run src/pages/EinsaetzePage` grün.
- [x] **Step 5:** Commit `feat(hilfe): Willkommenskarte auf der Einsatzliste`.

### Task 9: Chunk-Schutz, Regeln und Anwenderdoku

**Files:**
- Create: `frontend/src/hilfe/hauptChunk.guard.test.ts`
- Modify: `docs/anwender/kapitel/einsatz-oberflaeche.md`, `docs/anwender/AGENTS.md` („Hilfe in der App“), `frontend/AGENTS.md` („UI-Form-Leitlinie (Drawer-Nutzung)“), ggf. `frontend/src/command-palette/AGENTS.md` (eine Zeile zu den Hilfe-Aktionen)

- [x] **Step 1:** Wächter: liest die Quelltexte von `kontextKapitel.ts`, `tastenkuerzel.ts`, `HilfeSeitenleisteProvider.tsx`, `HilfeKnopf.tsx`, `WillkommenKarte.tsx`, `willkommen.ts`, `command-palette/befehle.ts` und `command-palette/typen.ts` (`?raw` oder `fs`) und prüft: kein statischer Import von `./kapitel`, `./HilfePage`, `./HilfeSeitenleiste` bzw. `../hilfe/kapitel`; `HilfeSeitenleiste` nur per `import(`. Mutationsprobe: einen Import probehalber einsetzen → rot.
- [x] **Step 2:** Kapitel `einsatz-oberflaeche`: Ablauf „### Hilfe zur Seite öffnen“ (Knopf „?“, Tasten ? und F1, Palette „Hilfe zu dieser Seite“, Reiter „Tastenkürzel“, „In der Hilfe öffnen“); in „Die Kopfzeile“ den Knopf nennen; neue Pfade in `quellen`. Form nach `docs/anwender/AGENTS.md` (Kapitelform, unpersönlich).
- [x] **Step 3:** `docs/anwender/AGENTS.md`, „Hilfe in der App“: Regel „Jedes Modul nennt sein Kapitel (`hilfeKapitel`), jede Seite ohne Modul steht in `KAPITEL_JE_PFAD` (`hilfe/kontextKapitel.ts`); Wächter `kontextKapitel.guard.test.ts`“, Seitenleiste (Provider ohne Texte, Leiste im Hilfe-Chunk, Wächter `hauptChunk.guard.test.ts`), Tasten ?/F1, Willkommenskarte (`willkommen_geschlossen`).
- [x] **Step 4:** `frontend/AGENTS.md`: zweite Ausnahme „Hilfe-Seitenleiste (`hilfe/HilfeSeitenleiste.tsx`): Nachschlagen neben der Arbeit, nur lesen, zwei Reiter als Segmentleiste, 480 px; die volle Hilfe bleibt die Route `/hilfe/<kapitel>` (LLH-1824)“.
- [x] **Step 5:** `vitest run src/hilfe` (inkl. `anwenderdoku.guard.test.ts`) und `mise exec -- pnpm -C frontend exec prettier --check ../docs/anwender/AGENTS.md AGENTS.md src/hilfe` → grün.
- [x] **Step 6:** Commit `docs: Hilfe zur Seite, Regeln für Seitenleiste und Kapitelzuordnung`.

### Task 10: Gesamtprüfung und Bilder

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` in einem Aufruf → grün (Ergebnis für „Geprüft“ im PR notieren).
- [x] **Step 2:** `cargo build` im Wurzelverzeichnis, dann Wegwerf-Spec `frontend/e2e/doku-bilder/zz-col12d3y.bilder.ts`: Bilder (a) Einsatzkopf mit „?“-Knopf, (b) offene Leiste auf der Lagekarte, (c) Reiter „Tastenkürzel“, (d) Willkommenskarte auf der Einsatzliste, (e) App-Kopf bei 360 px; Ablage außerhalb `docs/anwender/bilder/`. Spec danach löschen.
- [x] **Step 3:** Plan vollständig abhaken, committen.
