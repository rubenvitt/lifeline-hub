# Design

## Context

Siehe `proposal.md` (Why). Stand des Scans auf `origin/alpha` `1fcd591`:

- **Schutzköpfe:** `routes::support::anhang_antwort` setzt `nosniff` und `ANHANG_CSP` (LFH-759),
  ebenso der Logo-Abruf (`routes/organisation.rs`) und die Karten-Assets (`routes/karte.rs`).
  Ohne `nosniff` sind der Download des Karten-Hintergrundbilds
  (`routes::karte_hintergrundbild::herunterladen`, liefert hochgeladene Bytes), alle
  JSON-/Fehlerantworten, der 405-Fallback, die Panik-500, der Lastabwurf der Zulassung und
  `static_files::serve`. Der Router endet in `src/app.rs` in einer Schichtkette (CatchPanic →
  Stammdaten-Live → Zulassung → Trace → Request-ID); `.layer()` hängt jeweils außen an.
  `static_files::content_type` liefert für jede ausgelieferte Endung einen passenden Typ, sonst
  `application/octet-stream`.
- **Inline-Pfade:** genau fünf Treffer für `` `/einsaetze/${` `` außerhalb von Tests und
  `routing/deeplinks.ts`. Der Guard `routing/inlinePfade.guard.test.ts` existiert, prüft aber nur
  `einsatz/` und `command-palette/` („repoweit wäre er rot geboren“). Nach dem Umzug ist er
  repoweit grün.
- **Farben:** `pages/farbliteral.guard.test.ts` verbietet Hex in Stil-Eigenschaften unter
  `pages/`, lässt Farben als Daten (`farbe: '#…'`) bewusst durch. Genau das sind die verbliebenen
  Stellen: `#333333` (DV-102-Tinte, Datenwert und Vorgabe des Farbfelds, dreimal definiert) und
  `#1677ff` (Vorgabe einer freien Skizze, persistiert, sechsmal). Die Palettenmaske ist ein
  `rgba()` in `CommandPalette.tsx`, außerhalb von `theme/`.

## Goals / Non-Goals

**Goals:**
- Jede Antwort trägt `nosniff`, ohne dass eine Route daran denken muss.
- Jeder Farbwert der Befunde hat genau eine Definition; der Vergleich im Zonen-Inspector kann
  nicht mehr gegen eine abweichende Kopie laufen.
- Der bestehende Inline-Pfad-Guard deckt ganz `frontend/src/` ab.

**Non-Goals:**
- Keine weiteren Schutzköpfe (CSP für die App, `Referrer-Policy`, HSTS …). Eine App-CSP hat
  eigene Bedingungen (`src/AGENTS.md`, Anhänge: `img-src blob:`, `worker-src 'self'`,
  `'wasm-unsafe-eval'`) und braucht eigene Entscheidung.
- Kein allgemeiner Guard gegen Hex-Datenwerte (wäre rot geboren, s. `farbliteral.guard`).
- Keine Umfärbung gespeicherter Zonen oder Zeichen; keine Nachtmodus-Variante der Maske.
- Pfade, die über eine Variable zusammengesetzt werden, bleiben ein Blindfleck des Guards.

## Decisions

### D1 — `nosniff` als äußerste Schicht über `SetResponseHeaderLayer::if_not_present`

Die Schicht kommt als letzte `.layer()` vor `with_state` in `src/app.rs` und liegt damit außen um
CatchPanic, Zulassung, Trace und Request-ID: sie sieht auch die Panik-500 und den Lastabwurf.
`if_not_present` lässt einen Kopf, den die Route schon setzt, unangetastet, sodass er nie doppelt
steht. Dafür bekommt `tower-http` das Feature `set-header` (gleiche Crate, keine neue
Abhängigkeit im Lockfile).

- *Alternative `overriding`:* gleiches Ergebnis heute, überschriebe aber künftig eine Route, die
  bewusst etwas anderes setzt. Verworfen.
- *Alternative `axum::middleware::map_response`:* kommt ohne Feature aus, ist aber eigener Code
  für das, was die Bibliothek schon kann. Verworfen.
- *Alternative nur am Hintergrundbild nachziehen:* schließt die eine Lücke, lässt die nächste
  neue Download-Route wieder ungeschützt. Verworfen; das Ticket verlangt die globale Schicht.

Die Einzel-Header an Anhang, Logo und Karten-Assets **bleiben**: ihre Tests sichern sie, und
die Routen sind auch ohne Router-Kette (Handler-Tests) korrekt. Die Regel steht danach in
`src/AGENTS.md` (neuer kurzer Abschnitt „Schutzköpfe“), die Anhang-Zeile verweist darauf.

### D2 — Inline-Pfade über bestehende Builder, Guard auf ganz `src/`

`einsatzPfad`, `einsaetzePfad` und `lageberichtePfad` existieren schon; kein neuer Builder. Der
Guard ändert nur seine Wurzel (`SRC` statt der zwei Verzeichnisse) und nimmt
`routing/deeplinks.ts` aus. Sein Kommentar zum „rot geboren“ fällt.

### D3 — Farben: Datenwerte als exportierte Konstanten am Fachort, Maske in `theme/tokens.ts`

- `#1677ff` → `FREIE_SKIZZE_VORGABE` in `pages/lagekarte/zonenStil.ts` (dort steht heute
  `FREIE_SKIZZE_FALLBACK`; Umbenennung, weil es zugleich die Vorgabe beim Anlegen ist).
  Kein Token: gespeicherte Zonen dürfen sich beim Themenwechsel nicht umdeuten (Kommentar in
  `Sidebar.tsx` bleibt sinngemäß an der Konstante).
- `#333333` → `FREIES_ZEICHEN_TINTE` in `pages/lagekarte/marker.ts` (dort steht sie heute
  privat), exportiert für Picker (Vorgabe des Farbfelds) und Inspector.
- Symbolkachel im `FreiesZeichenInspector`: ohne eigene Farbe `rollen.text2` statt der Tinte.
  `text2` ist die Lauftext-Rolle der Listen und in beiden Modi auf `paneel` lesbar; die Tinte
  bleibt für Karte und Farbfeld, weil das Zeichen dort auf weißem Grundzeichen steht.
  *Alternative `steuerRahmen`:* trägt WCAG 1.4.11 für Rahmen, ist aber keine Textrolle und das
  Kürzel „TZ“ ist Text. Verworfen.
- Palettenmaske → `paletteMaske` in `theme/tokens.ts`, als eigenständiger, modusunabhängiger
  Export neben `rahmenFarben` (keine `Farbrolle`, also kein Spiegel in `rollen.css` nötig). Die
  Begründung „in beiden Modi dieselbe Abdunkelung, die Palette ist ein Fokusmoment“ zieht mit.
  *Alternative antds `colorBgMask` global setzen:* änderte die Maske aller Modals. Verworfen.

## Risks / Trade-offs

- [Eine Antwort ohne oder mit falschem Content-Type wird unter `nosniff` vom Browser
  verworfen (Skript/Style)] → `static_files` liefert JS/CSS mit korrektem Typ (Tests vorhanden);
  den Typ je Endung sichern die Unit-Tests in `src/static_files.rs`, der Integrationstest prüft
  `nosniff` am Frontend-Fallback (im Test ohne eingebettetes Bundle). Karten-Assets setzen `nosniff` schon heute.
- [SSE-Strom (`/api/live`, Einsatz-Strom) bekommt den Kopf] → harmlos, `text/event-stream` wird
  nicht gesnifft; der bestehende Live-Test läuft im Gate mit.
- [Feature `set-header` fehlt in einem Offline-Build-Cache] → reines Feature-Flag derselben
  Crate, `Cargo.lock` ändert sich nicht.
- [Kachelfarbe ändert sich sichtbar] → gewollt, nur für farblose freie Zeichen; Test pinnt beide
  Fälle.

## Migration Plan

Keine Daten- oder Schemaänderung. Rückweg: Commit zurücknehmen.
