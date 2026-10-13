# Proposal

## Why

Eine Organisation ohne Stabsarbeit (Führungsstufe B/C) muss den Stab heute in jedem neuen Einsatz
einzeln ausblenden, denn die Sichtbarkeit eines Moduls kennt nur den Einsatz. Für die Rolle gibt
es längst eine Vorgabe der Organisation, für die Sichtbarkeit nicht. Entschieden ist der Weg in
LLH-1116 (`openspec/changes/archive/2026-10-12-wgnb0am2-stab-abwaehlbar/design.md`, D1 und D2,
freigegeben von Ruben am 12.10.2026). Diese Change setzt ihn als Folgeticket F1 (LLH-1179) um.

## What Changes

- **Sichtbarkeits-Vorgabe der Organisation je Modul:** Die Organisation kann jedes ausblendbare
  Modul für alle Einsätze ausblenden. Ohne Vorgabe bleibt es sichtbar.
- **Auflösung zur Lesezeit:** `sichtbar` = Einsatz ?? Organisation ?? sichtbar, dieselbe
  Rangfolge wie bei der Rolle. Kopiert wird beim Anlegen nichts. Eine geänderte Vorgabe wirkt
  auf jeden Einsatz ohne eigenen Wert, auch auf einen laufenden.
- **Der Einsatz kann in beide Richtungen überstimmen.** Ein Einsatz-Override trägt die
  Sichtbarkeit jetzt optional: kein Wert = erbt. Eine Override-Zeile, die nur eine Rolle trägt,
  übergeht die Vorgabe der Organisation nicht mehr.
- **Migration:** `org_modul_einstellung` bekommt eine Spalte `sichtbar`.
  `einsatz_modul_override.sichtbar` wird nullbar (Tabellen-Neubau). Jede bestehende `1` wird zu
  „erbt“, jede `0` bleibt eine Ausblendung.
- **API:**
  - **BREAKING (intern):** `GET /api/org-modul-einstellungen` liefert je Modul ein Objekt
    `{ benoetigte_rolle, sichtbar }` statt nur der Rolle.
  - `PUT /api/org-modul-einstellungen/{modul_key}` nimmt zusätzlich `sichtbar` an. Es bleibt nur
    für den System-Admin offen.
  - Im Einsatz nehmen `GET` und `PUT …/modul-overrides` für `sichtbar` auch `null` an.
  - Einziger Abnehmer ist das eigene Frontend; es zieht im selben PR mit.
- **Verwaltung:** Das Paneel „Rollen-Vorgabe je Modul“ heißt „Module für alle Einsätze“ und
  bekommt eine Spalte „Sichtbar“. Ein Hinweis sagt, dass die Vorgabe auf alle Einsätze ohne
  eigene Einstellung wirkt, auch auf laufende.
- **Einsatz-Editor „Module“:**
  - Der Schalter zeigt den wirksamen Wert. Blendet die Organisation das Modul aus, steht
    darunter gedämpft „Vorgabe der Organisation: ausgeblendet“.
  - Wer den Schalter umlegt, setzt einen eigenen Wert. „Vorgabe übernehmen“ nimmt ihn zurück.
- **Anwenderdoku:** `verwaltung.md` und `einsatz-einstellungen.md` werden nachgezogen, Bilder
  neu aufgenommen.
- Unverändert: Nicht ausblendbare Module (`einsatzdaten`, `einsatz-einstellungen`) bleiben immer
  sichtbar. Der System-Admin erreicht ein ausgeblendetes Modul weiter über seine Adresse, sieht
  es aber in keiner Navigation.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `modul-freigabe`: Die Sichtbarkeit folgt Einsatz ?? Organisation ?? sichtbar. Ein
  Einsatz-Override kann die Sichtbarkeit offen lassen. Neu sind der Schreibweg der
  Sichtbarkeits-Vorgabe, die Anzeige von wirksamem Wert und Herkunft im Editor „Module“ und das
  Paneel „Module für alle Einsätze“. Dazu kommt der Fall, dass eine Org-Vorgabe die Freigaben
  ohne Neuladen ändert.

## Impact

- **Backend:**
  - `src/einsatz/berechtigung.rs` (`modul_freigabe`, `lade_modul_regeln`),
    `src/einsatz/effektiv.rs`
  - `src/einsatz/modul_override.rs`, `src/org/modul_einstellung.rs`
  - `src/routes/einsatz.rs` (Override-PUT), `src/routes/org_einstellungen.rs` (Org-GET/PUT),
    `src/api_doc.rs`
  - neue Migration `0185`
  - Tests in `tests/modul_freigaben.rs`, `tests/modul_override.rs`, `tests/org_einstellungen.rs`
    und `src/db.rs`
- **Frontend:**
  - `pages/einstellungen/EinsatzModule.tsx`, `EinsatzDefaults.tsx`, `ModulEinstellungsListe.tsx`
  - `api/orgEinstellungen.ts`, `api/types.ts`, generierte Typen
  - Bilder-Specs `e2e/doku-bilder/verwaltung.bilder.ts` und `einsatz-einstellungen.bilder.ts`,
    e2e `modulfreigabe-org-vorgabe.spec.ts`
- **Doku:** `docs/anwender/kapitel/verwaltung.md`, `einsatz-einstellungen.md` samt Bildern.
- **Daten:** Bestehende Einsatz-Overrides mit `sichtbar = 1` gelten danach als „erbt“. Bis zur
  ersten Org-Vorgabe ändert sich dadurch nichts.
