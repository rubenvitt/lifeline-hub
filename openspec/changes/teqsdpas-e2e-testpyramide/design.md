# Design

## Context

Siehe proposal.md, „Why“. Stand im Code (12.11.2026):

- **Laufzeit:** `frontend/e2e/laufzeiten.json` führt Sekunden je (Projekt, Datei), Chromium
  264 Dateien, Summe 20.124 s ≈ 335,4 min. Die Spitze: `gate3-trefflaeche` 34,8 min,
  `gate1-ueberlauf` 21,9, `fokus-verdeckung` 13,6, `lagekarte-touch` 10,3,
  `trefflaeche-pruefflaechen` 9,9. `scripts/e2e-anteile.mjs` verteilt die Dateien danach auf die
  vier Shards. Die Tabelle frischt der CI-Job „Testberichte zusammenführen“ als Artefakt
  `e2e-laufzeiten` auf.
- **Anmeldung:** `anmelden` (`e2e/trefflaeche-kern.ts:35`) und `anmeldenAls`
  (`e2e/rollen-kern.ts:33`) laden `/login`, füllen das Formular und warten auf `/einsaetze`: zwei
  volle App-Starts vor der Zielseite. Aufrufe in der Suite: `anmelden(` 890×,
  `anmeldenAlsAdmin(` 208×, `wechsleZuRolle(` 128×, `anmeldenAls(` 75×. Rund 40 Specs tragen eine
  eigene Kopie `anmelden`, 154 Stellen füllen `Benutzername` direkt. Die API-Anmeldung gibt es
  schon: `anmeldenOhneStartseite` (`e2e/lageplan-kern.ts:66`, 17×). `page.request` teilt die
  Cookies mit dem Browserkontext.
- **Dichte:** `stelleDichte` (`e2e/trefflaeche-kern.ts:69`) schreibt `lifeline-hub.dichte` und
  lädt neu, weil `ThemeModeProvider` den Speicher nur beim Montieren liest. Das Muster
  `goto(pfad)` → `stelleDichte` steht in gate3 69×, dazu in `fokus-verdeckung`,
  `pegel-pruefliste` und `leisten-flaeche`: zwei Ladungen je Stufe.
- **Gate 1:** `gate1Vorbereiten` (`gate1-ueberlauf.spec.ts:383`) meldet an, legt einen Einsatz an
  und sät rund 13 Datensätze, und zwar in jedem der 48 Tests (Breite × Durchgang × Rolle).
- **Rollen:** `wechsleZuRolle` legt ein Konto an, trägt es ein, quittiert seine
  Benachrichtigungen und wechselt im selben Kontext (`rollen-kern.ts:147`). Viele Gates führen
  Admin und Beobachter als getrennte Tests, die dieselben Daten je neu säen.
- **Gate-Kataloge:** Es gibt keinen gemeinsamen Seitenkatalog. gate3 hat rund 65 handgeschriebene
  Tests mit Freitext-Titeln, Gate 1 eine Routentabelle (`GATE1_DURCHGAENGE`) mit Familien-Titeln.

## Goals / Non-Goals

**Goals:**

- Mindestens 10 % weniger Chromium-Testzeit (≥ 34 min) bei gleicher Messmenge.
- Die Spec `layout-gates-rollen` bleibt erfüllt: jede Rolle, jede Vorbedingung, jede
  Freistellungsregel.

**Non-Goals:**

- Keine Änderung an CI-Ablauf, Shard-Zahl, Fristen oder `scripts/bereiche.sh`.
- Kein Umbau der Gates auf einen gemeinsamen Seitenkatalog.
- Keine Kürzung in Firefox oder WebKit über das hinaus, was die geteilten Helfer mitbringen.
- Keine neuen Gate-Messungen. Wo beim Umbau eine Lücke auffällt, wird sie als Zunder-Aufgabe
  erfasst, nicht hier geschlossen.

## Decisions

### D1 Keine Auswahl der Layout-Gates nach dem Diff

Alle Gate-Fälle laufen in jedem e2e-Lauf (Spec `e2e-zuschnitt`, „Layout-Gates laufen in jedem
Lauf vollständig“).

- **Verworfen: seitengenaue Auswahl** (der Vorschlag im Auftrag). Dafür bräuchte es einen
  Importgraphen (Seiten importieren aus vielen Modulordnern, `EtbPage` aus 11), einen
  Seitenschlüssel an jedem Test der rund 13 Gate-Dateien, einen Filter per Umgebungsvariable,
  eine angepasste Tot-Erkennung der Freistellungen in Gate 1 (`gate1Messen` prüft gegen
  `alleRouten`) und eine Gewichtung je Test statt je Datei in `e2e-anteile.mjs`. Gewinn: Von
  43 Commits mit `frontend/src` unter den letzten 80 auf `alpha` berührten 24 geteilte Ordner
  (`components/`, `theme/`, `einsatz/`, `routing/` …) und müssten ohnehin voll laufen. Nur 10
  (23 %) blieben in einem Fachordner.
- **Verworfen: grobe Auswahl nach Bereich** (Gates nur, wenn `frontend/src` geändert ist).
  Backend-Änderungen ändern, was die Seiten zeigen. Ein Fehler, den erst `alpha` findet,
  blockiert dort den Alpha-Release (`release` braucht `e2e`).
- **Gewählt:** Die Laufzeit wird im Gate selbst gespart (D2–D7). Das wirkt auf PR und `alpha`
  gleich.

### D2 Anmeldung über die API in den geteilten Helfern

Ein Anmelde-Kern (`e2e/anmelde-kern.ts`) bietet:

- `anmeldenPerApi(page, benutzer, passwort, { startseite })`: `POST /api/auth/login` über
  `page.request`. Danach wird zugesichert, dass die Antwort eine Sitzung liefert (kein
  `passwort_wechsel_erforderlich`).
- **Vorgabe `startseite: true`:** danach `goto('/einsaetze')` und warten auf die URL. Damit gilt
  dieselbe Nachbedingung wie bisher, und alle rund 1.300 Aufrufe der geteilten Helfer bleiben
  gültig. Gespart wird die Ladung von `/login` samt Formular.
- **`startseite: false`:** für Fälle, deren nächster Schritt ohnehin ein `goto` ist (Muster von
  `anmeldenOhneStartseite`). Das spart auch die Einsatzliste. Die Umstellung läuft mechanisch,
  wo der nächste Befehl `page.goto(` ist.

`anmelden`, `anmeldenAls`, `anmeldenAlsAdmin`, `wechsleZu`, `wechsleZuAdmin` rufen den Kern.
`anmeldenOhneStartseite` wird zum Alias. Die lokalen Kopien in den Specs werden durch Importe
ersetzt. Wo eine Kopie mehr tut (Dichte, Helligkeit oder Modus vorab per `addInitScript`), bleibt
dieser Teil als eigener Schritt vor dem Kern stehen.

- **Ausnahme:** Specs, die die Anmeldung selbst prüfen (Formular, Zweitfaktor, Passkey, SSO,
  Einmalpasswort, Rückkehr nach Abmeldung, Sitzung über mehrere Tabs). Sie stehen in einer Liste
  im Riegel.
- **Riegel:** `no-restricted-syntax` für `e2e/**` gegen `getByLabel('Benutzername')` bzw. das
  Ausfüllen des Anmeldeformulars, mit dieser Liste als Ausnahme. Muster wie beim Riegel von
  `einsatz-kern` (LFH-1114).
- **Alternative `storageState` je Worker:** verworfen. Die Gates wechseln Rollen im selben
  Kontext, und viele Specs legen eigene Konten an. Ein vorab gespeicherter Zustand bindet einen
  Benutzer an den Kontext, und die 412-Regel (Sitzung über mehrere Tabs) macht jeden Wechsel
  dann zu einem Sonderfall. Die API-Anmeldung kostet einen Request und keine Ladung, der Rest des
  Gewinns wäre klein.

### D3 Dichte vor dem Laden setzen

Neuer Helfer `ladeInDichte(page, pfad, dichte)` in `trefflaeche-kern.ts`:

1. Steht die Seite schon auf dem Ursprung der App, schreibt `page.evaluate` den Schlüssel.
2. Dann `goto(pfad)`.
3. Dann die bestehende Wache `data-dichte` auf `<html>`.

Steht die Seite noch auf `about:blank`, lädt der Helfer wie bisher (`goto` und `stelleDichte`)
und meldet das nicht als Fehler. Das trifft nur die erste Stufe eines Falls, der mit
`startseite: false` angemeldet hat. Die Gates melden mit Startseite an.

- **Alternative `addInitScript` je Stufe:** verworfen. Init-Skripte häufen sich im Kontext und
  laufen bei jeder Navigation. Ein späteres `stelleDichte` im selben Fall würde still
  überschrieben, die Wache würde dann rot statt zu messen.
- `stelleDichte` bleibt für Fälle, die die Stufe auf einer schon offenen Seite wechseln müssen.

### D4 Saat einmal je Worker in Gate 1

`gate1Vorbereiten` wird eine Worker-Fixture. Sie öffnet einen eigenen API-Kontext, meldet als
Admin an, legt den Einsatz an und sät, mit und ohne `vorlage` je einmal. Dazu legt sie einen
Beobachter je Einsatz an, trägt ihn ein und quittiert seine Benachrichtigungen. Jeder Test meldet
sich nur noch an (D2) und misst.

- **Vorbedingung:** Die Messung schreibt nicht. Das wird je Durchgang geprüft (`vorbereiten`,
  `lesend`). Ein Durchgang, der schreibt, behält die Saat je Test.
- Die Titel- und h1-Prüfung aus `orientierung.spec.ts:40` läuft im Admin-Durchgang auf 1366 px
  für die Routen mit, die Gate 1 ohnehin lädt. `orientierung` behält nur die Module, die Gate 1
  nicht lädt.

### D5 Gleiche Flächen von gate3 und `fokus-verdeckung` einmal laden

Wo beide Gates dieselbe Seite mit derselben Saat, Rolle, Breite und Stufe messen
(`SPERR_SZENARIEN`, Einheit mit gesperrtem Personal, Unterkunft, Vorplanung, Vorlage), misst
**ein** Fall beide Eigenschaften. Er steht in gate3, die Fokusmessung kommt aus `fokus-kern.ts`.
Bei Abweichungen in Saat oder Ablauf bleibt es bei zwei Fällen.

Die Dichtetests von `fokus-verdeckung` (`:747`, `:2483`, `:2620`, `:2767`) werden je Breite zu
einem Fall über `STAFFEL` gebündelt (D3 je Stufe).

### D6 Admin- und Beobachter-Geschwister säen einmal

Wo ein Gate Admin und Beobachter als getrennte Tests mit gleicher Saat führt (gate3,
`trefflaeche-pruefflaechen`, `leisten-flaeche`, `pegel-pruefliste`), wird daraus ein Fall:

1. als Admin säen und messen, in `test.step('Admin …')`;
2. `wechsleZuRolle`;
3. Vorbedingung des Rollenzweigs und Messung, in `test.step('Beobachter …')`.

Die Spec `layout-gates-rollen` bleibt erfüllt: Die Vorbedingung steht vor der Messung, und die
Mutationsprobe (nur der Nicht-Admin-Zweig verbreitert) macht den Beobachter-Schritt rot, während
der Admin-Schritt im Bericht grün steht. Gate 1 behält getrennte Durchgänge, dort spart D4 die
Saat.

### D7 Duplikate und `kopfhoehe-tonpruefung`

Je Fall eine Mutationsprobe am übernehmenden Test, festgehalten in `pruefliste.md` dieser Change:

| e2e-Fall | übernimmt | Weg |
|---|---|---|
| `funkplan.spec.ts:211`, `:231`, `:254` | `FunkplanPage.test.tsx:386`, `:427`, `:280` | streichen |
| `funkplan.spec.ts:458` (Sprechgruppen, Route-Mock) | neuer Fall in `FunkplanPage.test.tsx` | verschieben |
| `lagekarte-smoke.spec.ts:763` (reiner API-Fall) | `tests/freies_zeichen.rs:226` | streichen |
| `dokumente.spec.ts:385`, `:409` | `DokumentePage.test.tsx:509–564`, `:313`; ETB-Nachweis zum PATCH neu in `tests/dokument.rs` | verschieben |
| `fernmeldeskizze.spec.ts:698`, `:643`, 403-Teil von `:1056` | `fernmeldenetz.test.ts:242`, Eigenschaftstest D11, `tests/stab_fernmeldeskizze.rs:154/:201` | Teile streichen, UI-Meldungen bleiben e2e |
| `command-palette.spec.ts:198` (Rangfolge) | `befehle.test.ts:1028` | Rangfolge streichen, Navigieren bleibt e2e; Einsatz per API statt Dialog |
| `trefflaeche-pruefflaechen.spec.ts:1761` (Gefahrenmatrix) | gate3 `:5073` | Deckungsprüfung nach gate3, Fall streichen |

`kopfhoehe-tonpruefung` (15 Breiten × 2 Rollen, `MESSDAUER_MS` 5 s): Gekürzt wird nur, was die
Herleitung (LFH-637, LLH-1232) trägt. Kandidaten sind eine Messdauer bis Endstand plus Nachlauf
statt fester 5 s und der Beobachter nur in den Bändern, in denen der Kopf je sprang (1100–1180
und 1340–1420 px). Trägt die Herleitung das nicht, bleibt die Spec unverändert. Die 10 % sind
ohne sie erreichbar.

### D8 Messung des Zielwerts

- **Vorher:** die Chromium-Summe der eingecheckten `laufzeiten.json`, 335,4 min.
- **Vor dem Archiv:** Je umgebauter Spec ein lokaler Lauf vorher und nachher (Chromium, gleiche
  `PW_WORKERS`). Die Summe der Differenzen muss ≥ 34 min sein, sonst kommt der Befund vor dem
  Archiv zur Sprache.
- **Akzeptanz:** dieselbe Summe aus dem CI-Lauf des PRs (Artefakt `e2e-laufzeiten`). Weil die
  Change vor dem PR archiviert wird (Projektregel) und e2e nur im PR-Lauf entsteht, wird die
  Tabelle danach als Commit im PR aufgefrischt und das Ergebnis in der archivierten
  `pruefliste.md` nachgetragen.

## Risks / Trade-offs

- [Die API-Anmeldung überspringt etwas, das nur der Formularweg tut, z. B. den
  Offline-Schnappschuss oder die Kanalmeldung an andere Tabs] → Das Erstladen nach `goto` geht
  denselben Weg wie ein Neuladen nach der Anmeldung (`/me`). Specs, die genau diesen Weg prüfen,
  stehen in der Ausnahmeliste des Riegels. Ein rot gewordener Fall nach der Umstellung wird
  einzeln untersucht, nicht pauschal zurückgedreht.
- [Die Saat je Worker macht Gate-1-Fälle voneinander abhängig] → nur für Durchgänge, die
  nachweislich nicht schreiben (D4). Jeder Test meldet sich neu an und lädt frisch.
- [Ein zusammengelegter Admin-/Beobachter-Fall bricht beim Admin ab, und der Beobachter wird
  nicht gemessen] → `test.step` zeigt die Stelle. Ein roter Admin-Teil ist ohnehin rot. Gate 1,
  wo die Trennung in der Spec steht, bleibt getrennt.
- [Mit einer Ladung weniger je Stufe sinkt die Wartezeit, und es treten Ladezustände auf, die
  der Reload bisher überdeckte] → Die Messhelfer warten schon heute wiederholt
  (`mindestensKnoten`, LFH-885). Neue Wackler werden mit `--repeat-each` gegen die umgebaute Spec
  geprüft, bevor sie als fertig gilt.
- [Großer Diff in vielen Specs] → Commits je Hebel (Kern, Anmeldung, Dichte, Gate 1, Paare,
  Duplikate, Regel). Die mechanische Umstellung der Anmeldung läuft als eigener Commit.
- [Die Schätzungen (≈ 2–3 s je gesparter Ladung) sind nicht gemessen] → Die lokalen
  Vorher-Nachher-Läufe je Spec (D8) zeigen früh, ob die 10 % halten. Reicht es nicht, kommt das
  vor dem PR zur Sprache.

## Migration Plan

Nur Testcode und Regeln; nichts auszurollen. Rückweg: Revert des PRs. `laufzeiten.json` wird mit
dem PR aufgefrischt, damit die Shards nach der neuen Verteilung schneiden.

## Open Questions

- Lässt sich das Artefakt `e2e-laufzeiten` aus dieser Cloud-Sitzung herunterladen? Wenn nicht,
  frischt Ruben die Tabelle aus dem PR-Lauf auf (Befehl im Kopf von `scripts/e2e-anteile.mjs`),
  und die Akzeptanz liest die Bilanz aus der Zusammenfassung des CI-Jobs.
