# Proposal

## Why

Der Neuentwurf „Instrumententafel“ führt unter Kräfte & Mittel ein Modul „Verpflegung“; die
Beispieldaten sprechen von „Verpflegung 250 EP je Schicht“ und einem Verpflegungstrupp.
LFH-620 hat entschieden, das als eigenes Fachmodul zu bauen (LFH-634). Heute kennt das System
weder einen Verpflegungsbedarf noch Ausgaben: ob die Kräfte und die Betreuten eines
Zeitfensters versorgt sind, steht nur auf Papier, und eine Unterdeckung fällt erst auf, wenn
jemand leer ausgeht. Die beiden Voraussetzungen sind inzwischen geliefert: LFH-635 hat die
Schichtfrage beantwortet (Schichten hängen an Einheiten, eine einsatzweite Schicht gibt es
nicht), LFH-639 stellt die Kopfzahl „in Betreuung“ zu einem Zeitpunkt bereit.

## What Changes

- Neues Fachmodul **Verpflegung** (Modul-Key `verpflegung`, Kategorie Kräfte & Mittel,
  zwischen Material und Ablösung, Route `/einsaetze/:einsatzId/verpflegung`). Backend und
  Frontend vollständig, keine Sprungmarke.
- Neue Entität **Verpflegungszeitfenster** (Bezeichnung, von, bis), eigenständig und nicht an
  die Schichten aus LFH-635 gebunden. Je Zeitfenster ein **erfasster Bedarf** in
  Essensportionen (EP), aufgeteilt in Einsatzkräfte, Betreute und weitere Personen, dazu
  Sonderkost je Kostform als Teilmenge.
- Der Bedarf wird **erfasst, nicht live gerechnet**. Beim Anlegen schlägt die Oberfläche die
  aktuelle Personalstärke und die Kopfzahl „in Betreuung“ zum Beginn des Zeitfensters vor –
  sichtbar, beschriftet und überschreibbar. Fehlt eine Quelle, bleibt das Feld leer statt 0.
- Neue Entität **Ausgabe** je Zeitfenster: Zeitpunkt, Ort, Menge in EP, Sonderkost je
  Kostform, optionaler Verweis auf eine Nachforderung, Bemerkung. Ausgaben sind
  append-only; eine falsche Ausgabe wird **zurückgenommen**, nicht bearbeitet. Nach dem
  Erfassen bietet die Oberfläche die Rücknahme als Rückgängig-Hinweis an.
- **Deckung je Zeitfenster:** Bedarf, ausgegeben und Fehlmenge (gesamt und je Kostform) als
  Zahl. Die Einstufung „offen“ (vor Beginn), „Unterdeckung“ (ab Beginn, Fehlmenge > 0) und
  „gedeckt“ steht als Wort und Rollenfarbe daneben (zweiter Kanal).
- **Nachschub hat eine Wahrheit:** Verpflegung führt keinen eigenen Liefer- oder
  Bestellstatus. Eine Ausgabe verweist optional auf eine Nachforderung desselben Einsatzes.
  „Nachfordern“ springt vorbelegt in die bestehende Nachforderungs-Erfassung; dafür bekommt
  die Nachforderungsseite einen Deeplink mit Vorbelegung.
- **ETB:** Anlegen, Ändern und Löschen eines Zeitfensters schreiben einen System-Eintrag.
  Einzelne Ausgaben und Rücknahmen schreiben keinen (Entscheidung des Auftraggebers,
  24.09.2026).
- **Stab:** S4 „Versorgung“ führt Verpflegung als Werkzeug statt Fahrzeuge (Entscheidung des
  Auftraggebers, 24.09.2026).
- Neues Live-Ereignis `verpflegung`, Codegen der Response-Typen, Schwärzungsregel,
  Registry-Eintrag, `MODUL_KEYS`/`PFAD_KEY`/Marker, Vertragskarte für die Deckung.
- **Kein Modulzähler** (der Entwurf zeigt keinen; `umsetzung.md` vergibt Zähler nur bei
  belegter Bedeutung) und **keine Offline-Queue** in v1 (Folgeticket LFH-688).
- **Prüfliste Einsatztauglichkeit** für die neue Seite.

## Capabilities

### New Capabilities

- `kraefte-verpflegung`: Verpflegung im Einsatz, also Zeitfenster mit erfasstem Bedarf in EP
  samt Sonderkost, Ausgaben mit Rücknahme, Deckung und Unterdeckung je Zeitfenster, der
  Bezug zur Nachforderung, die Bedarfsvorschläge aus Personal und Betreuung, der
  ETB-Nachweis sowie Rechte, Live-Verteilung und Schwärzung.

### Modified Capabilities

(keine: `lagekarte-fachebenen` ist nicht berührt)

## Impact

- **Datenbank:** neue Migration mit den Tabellen `verpflegung_zeitfenster` und
  `verpflegung_ausgabe`. Nummer vorläufig `0118`; vor dem Merge mit
  `scripts/check-migrationen.sh` gegen `origin/alpha` geprüft.
- **Backend:** neues Modul `src/verpflegung/`, Routen in `src/routes/verpflegung.rs`.
  Berührt werden `src/einsatz/modul.rs`, `src/live/mod.rs`, `src/einsatz/schwaerzung_registry.rs`,
  `src/api_doc.rs`, `src/app.rs`, `src/lib.rs`, `src/routes/mod.rs`.
- **API:** neue Endpunkte unter `/api/einsaetze/{id}/verpflegung`. Bestehende Endpunkte bleiben
  unverändert.
- **Frontend:** neue Seite, API-Client und Dialoge. Berührt werden `modulRegistry.ts`,
  `App.tsx`, `deeplinks.ts`, `queryKeys.ts`, `api/types.ts`, `theme/statusFarben.ts`,
  `stab/sachgebiete.ts`, dazu `pages/NachforderungenPage.tsx` und
  `nachforderungen/NachforderungFormular.tsx` (Vorbelegung per Deeplink) und die generierten
  Typen.
- **Tests und Guards:** `tests/modul_override.rs`, `tests/enum_wire_kontrakt.rs`,
  `src/live/mod.rs` (Gate-Pin), Schwärzungs-Registry-Tests, `liveEvent.contract.test.ts`,
  `queryKeys`-Guards, `statusFarben.test.ts` (Kartenzahl 23 → 24), `sprungmarken.test.ts`,
  `sachgebiete.test.ts`, e2e `gate1-ueberlauf` und `gate3-trefflaeche`.
- **Folgeticket:** Offline-Fähigkeit der Ausgaben-Erfassung (LFH-688).
