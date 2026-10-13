# Design

## Context

Warum S6 ein eigenes Modul wird, steht in proposal.md. Den Schnitt hat LLH-1116 entschieden
(`openspec/changes/archive/2026-10-12-wgnb0am2-stab-abwaehlbar/design.md`, D3, D4, D6, D7, Stellenliste,
„Folgen je Folgeticket → F2“). Diese Change setzt F2 um. Das Muster ist die gemergte Change
`openspec/changes/archive/2026-10-13-llj8s2rt-lagebesprechung-eigenes-modul/` (LLH-1111). Den
Bestand hat ein Scope-Lauf am 13.10.2026 auf `alpha` (nach dem Merge von LLH-1111) erhoben.

**Backend**
- `src/routes/stab.rs`: 9 Kommunikationsplan-Handler (`kommunikationsplan_laden` bis
  `kommunikationsplan_kanal_loesen`, Z. 342–574) und 16 Skizzen-Handler (`fernmeldeskizze_laden`
  bis `fernmeldeskizze_bereich_entfernen`, Z. 671–1199). Alle prüfen
  `EinsatzLesezugriff<Stab>` bzw. `EinsatzSchreibzugriff<Stab>`, jede Schreibaktion ruft den
  Helfer `sse()` (Z. 34) mit `LiveEvent::Stab`.
- `src/einsatz/modul.rs`: `MODUL_KEYS: [&str; 32]`, `modul_marker!` erzeugt Marker und
  `MARKER_KEYS`, `PFAD_KEY` hat einen Eintrag `…/stab` (Z. 161). `key_fuer_pfad` nimmt den
  längsten Präfix an einer Segmentgrenze, Unterpräfixe brauchen keine Codeänderung.
- `src/live/mod.rs`: `modul_keys()` ist ein vollständiges `match`, `Stab → ["stab"]`. Der einzige
  weitere Absender von `Stab` ist `routes/einsatz_personal.rs:300` (Besetzung) und bleibt.
- Der Server bettet keine Stab-Daten in Kommunikationsplan oder Skizze ein. Die Besetzung holt
  allein der Client über `GET …/stab`.
- „Fernmeldeskizze anfügen“ ist serverseitig am Modul des Dokuments gegatet, nicht am Stab.
- Höchste Migration ist `0184_lagebesprechung_modul.sql`, ihr Test `src/db.rs:450-524`.

**Frontend**
- `pages/FunkplanPage.tsx` (Darstellungen Tabelle/Skizze/Sprechgruppen als `Segmentleiste`,
  `?ansicht=` apply-then-clean) und `pages/KommunikationsplanPage.tsx` prüfen beide
  `useStabFreigabe` fail-closed. Ihr h1 ist „Funkplan“ bzw. „Kommunikationsplan“, der Ortspfad
  läuft über den Stab.
- `stab/useNetzQuellen.ts` gatet alle Netzquellen auf `stabFrei`. Die Besetzung (Kasten
  „Einsatzleitung“) ist eine davon.
- Rechte der Skizze: `recht: 'stab'` in `stab/fernmeldeskizze.ts`, `useSkizzenAktionen.ts`,
  `skizze/bedienung.ts`, `skizze/wirkung.ts`.
- `einsatz/sprungmarken.ts` führt die Marken Funkplan, Fernmeldeskizze und Kommunikationsplan
  hinter „Stab“ (LLH-1127, Change `gw8jul0f-stab-sprungmarken-palette`). Deren Risiko-Absatz sah
  vor, dass die S6-Marken mit dem Modul umziehen.
- `einsatz/EinsatzLayout.tsx` gatet jede Route über `modulAusPfad` (Segment nach der Einsatz-ID).
  `…/stab/funkplan` gehört dort heute zu `stab`. Eine Weiterleitung hinter dem Gatter liefe bei
  ausgeblendetem Stab nie.
- `modulRegistry.test.ts` begrenzt die Beschreibung auf 40 Zeichen. Die Herleitung nennt
  „Funkplan, Fernmeldeskizze, Sprechgruppen, Kommunikationsplan“ (60 Zeichen).
- `api/queryKeys.ts`: `stabKommunikationsplan` und `stabFernmeldeskizze` liegen unter dem Prefix
  `einsatz-stab`. `LAGEBILD_OFFLINE` trägt `[EINSATZ_KEYS.stab, 'kommunikationsplan']`.

## Goals / Non-Goals

**Goals:**
- Ein Modul mit eigener Freigabe, eigenem Live-Ereignis und eigener Seite. Von der Freigabe des
  Stabs hängt nur noch ab, was wirklich Stab-Daten sind: Besetzung und Sachgebiete.
- Kein Lesezeichen und kein Verweis in Texten bricht.
- Kein Bestandsnutzer sieht nach der Einführung mehr als vorher, außer dem gewollten Fall
  „Stab ausgeblendet“ (D7 der Herleitung).

**Non-Goals:**
- Kein neuer Inhalt in Funkplan, Skizze, Sprechgruppen oder Kommunikationsplan.
- Keine neuen API-Pfade (D4 der Herleitung). Die Pfade sind Grenzwerte (`AGENTS.md`,
  „Bezeichner-Sprache“).
- Kein Verschieben von Dateien aus `frontend/src/stab/` oder `src/stab/`. Die Herleitung lässt sie
  unter `stab/`, der Geltungsbereich der Regeldatei wird „Stab und Fernmeldewesen“.
- Neugestaltung der Stab-Seite (LLH-1124). Diese Change macht nur die S6-Einstiege zu Sprüngen
  mit Sperre.
- Sichtbarkeits-Vorgabe je Organisation (LLH-1179, F1).
- Modulzähler (Spec `modul-zaehler`: nur mit festgelegter Bedeutung).

## Decisions

### D1 Registry-Eintrag und Schlüssel

- `fernmeldewesen` in `modulRegistry.ts` mit `kategorie: 'kommunikation'`,
  `label: 'Fernmeldewesen'` und `route: 'fernmeldewesen'`, als letzter Eintrag der Kategorie
  (nach Nachforderungen). Der Kopf der Kategorie bleibt „Chat“. Darauf verlässt sich das
  Doku-Bild `arbeitsflaeche`.
- `MODUL_KEYS` wird auf 33 Einträge gespiegelt, an derselben Stelle.
- **Beschreibung „Funkplan, Skizze, Kommunikationsplan“** (36 Zeichen). Die Wörter aus der
  Herleitung sprengen die Grenze von 40 Zeichen. „Funkplan“ steht vorn, damit „Funk“ in der
  Palette trifft. Die Sprechgruppen stehen im Reiter und in den Schlagworten.
  *Verworfen:* die Grenze für dieses Modul aufheben. Sie hält Modulmenü und Palette einzeilig
  (Spec `modul-benennung`, „Handy“).
- Ein Icon aus Icons8 iOS 27 Outlined (Funkmast oder Walkie-Talkie) über `scripts/icons/` und
  `icons/index.ts`, wie bei LLH-1111. Die Auswahl steht unter Open Questions.

### D2 Backend: Marker tauschen, Pfade bleiben, Handler bleiben in `routes/stab.rs`

- Neuer Marker `Fernmeldewesen => "fernmeldewesen"` in `modul_marker!`.
- `PFAD_KEY` bekommt `("/api/einsaetze/{id}/stab/kommunikationsplan", Some("fernmeldewesen"))`
  und `("/api/einsaetze/{id}/stab/fernmeldeskizze", Some("fernmeldewesen"))`, mit Kommentar auf
  D4 der Herleitung.
- Die 25 Handler wechseln von `<Stab>` auf `<Fernmeldewesen>`, ihre Schreibaktionen auf einen
  zweiten Helfer `sse_fernmeldewesen()`. Der Wächter `tests/einsatz_kontext_guard.rs` erzwingt,
  dass Marker und `key_fuer_pfad` übereinstimmen. Er wird also rot, wenn ein Handler vergessen
  wird.
- Gesperrtes oder ausgeblendetes Modul: 403, fremder oder unbekannter Einsatz: 404
  (`src/AGENTS.md`, Statuscode-Konvention). Der Extraktor regelt das bereits.
- Doc-Kommentare in `routes/stab.rs` und `stab/fernmeldeskizze.rs`, die „sendet `LiveEvent::Stab`“
  sagen, werden nachgezogen.

*Verworfen:* die Handler nach `src/routes/fernmeldewesen.rs` verschieben. Das wäre sauberer im
Besitz, aber ein großer Diff in einer Datei, die LLH-1124 und LLH-1127 auch anfassen, und die
Pfade sagen weiter `stab`. Die Abschnittskommentare in `routes/stab.rs` benennen den Besitzer.

### D3 Live: eigenes Ereignis `fernmeldewesen`

- `LiveEvent::Fernmeldewesen` (Wire `fernmeldewesen`, Gate `["fernmeldewesen"]`). Er wird in die
  Pin-Tabelle `gate_mengen_sind_gepinnt`, in `tests/enum_wire_kontrakt.rs` und in den
  Typ-Codegen aufgenommen.
- `LiveEvent::Stab` bleibt für Besetzung und Checkliste, sein Kommentar wird gekürzt.
- Frontend:
  - neuer Prefix `EINSATZ_KEYS.fernmeldewesen = 'einsatz-fernmeldewesen'`
  - die Keys `fernmeldewesenKommunikationsplan(id)` und `fernmeldewesenSkizze(id)` ersetzen
    `stabKommunikationsplan` und `stabFernmeldeskizze`
  - `EINSATZ_STREAM_EVENTS.fernmeldewesen = [EINSATZ_KEYS.fernmeldewesen]`
  - `stab` behält `[stab, auftraege, erinnerungen, modulZaehler]`, sein Kommentar verliert
    Kommunikationsplan und Skizze
- `LAGEBILD_OFFLINE` trägt `[EINSATZ_KEYS.fernmeldewesen, 'kommunikationsplan']`. Die Skizze bleibt
  draußen wie heute.

*Verworfen:* `Stab` zusätzlich auf `fernmeldewesen` öffnen. Dann erführen Leser des
Fernmeldewesens von jeder Besetzungsänderung und Stab-Leser von jeder Skizzenänderung.

### D4 Freigaben: nur die Rolle wandert

Migration `0186_fernmeldewesen_modul.sql`, gebaut wie `0184`, mit `'fernmeldewesen'` statt
`'lagebesprechung'`:

```sql
INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at)
SELECT einsatz_id, 'fernmeldewesen', 1, benoetigte_rolle, datetime('now')
FROM einsatz_modul_override
WHERE modul_key = 'stab' AND benoetigte_rolle IS NOT NULL;

INSERT INTO org_modul_einstellung (org_id, modul_key, benoetigte_rolle, geaendert_at)
SELECT org_id, 'fernmeldewesen', benoetigte_rolle, datetime('now')
FROM org_modul_einstellung
WHERE modul_key = 'stab' AND benoetigte_rolle IS NOT NULL;
```

- Den Test `migration_0185_uebernimmt_nur_die_stab_rolle` gibt es neben dem von 0184 in
  `src/db.rs`, mit demselben Datensatz. Wird die Nummer beim Merge umgelegt (LFH-1014), ziehen
  Name und Filter `version < N` mit.
- Versionshinweis: Der `feat`-Commit nennt in Betreff und Text „Wer den Stab ausgeblendet hat,
  bekommt das Fernmeldewesen zurück“. Bei großen Releases liest `ki-notizen.mjs` nur die Betreffzeilen.

### D5 Modulseite: eine Hülle, vier Reiter, Darstellung bleibt Sichtvorgabe

- Beide Seiten tragen h1 `modulName('fernmeldewesen')` („Fernmeldewesen“), Ortspfad Einsatz ›
  Fernmeldewesen, und darunter die Reiterleiste `fernmeldewesen/FernmeldewesenReiter.tsx`
  (Funkplan · Fernmeldeskizze · Sprechgruppen · Kommunikationsplan). Die Reiter sind antd `Tabs`
  wie in `pages/AuftraegePage.tsx`, nur die Leiste: Druckwurzel und Seitenkopf bleiben bei der
  Seite, die Leiste geht nicht aufs Papier. Eine eigene Hüllen-Seite entfällt, weil
  `EinsatzSeite` schon Kopf und Ortspfad trägt.
- Die `Segmentleiste` „Darstellung“ des Funkplans entfällt, weil die Reiter sie ersetzen. Die Druckköpfe nennen weiter die
  Darstellung („Funkplan“, „Fernmeldeskizze“, „Sprechgruppen“, „Kommunikationsplan“).
- Routen: `MODUL_ELEMENTE.fernmeldewesen` zeigt den Funkplan. Unterroute
  `fernmeldewesen/kommunikationsplan`. Die drei Darstellungen bleiben ein Seitenzustand mit
  `?ansicht=` als einmaliger Sichtvorgabe (apply-then-clean, wie heute). Der Reiter
  „Kommunikationsplan“ navigiert, die übrigen drei setzen die Darstellung. Aus dem
  Kommunikationsplan navigieren sie auf `funkplanPfad(id, { ansicht })`.
- `funkplanPfad` liefert `…/fernmeldewesen` (mit `ansicht`), `kommunikationsplanPfad`
  `…/fernmeldewesen/kommunikationsplan`.
- Die Übernahme in Lagebericht und Befehl bleibt, wo sie ist (Funkplan und Skizze).

*Verworfen:*
- Die Darstellungen als eigene Unterrouten (`…/fernmeldewesen/skizze`). D4 der Herleitung legt die
  zwei Adressen fest.
- `?ansicht=` als bleibender Zustand der Adresse wie `?reiter=befehle` in den Aufträgen, mit
  „Zurück“ zwischen den Reitern. Das änderte die Anforderung „Sichtvorgabe aus einem Link“ (der
  Parameter wird entfernt) samt Sprungmarken, Doku und Tests. Diese Change schneidet nur die
  Freigabe um. Fehlt „Zurück“ zwischen den Reitern im Feld, wird das ein eigenes Ticket.

### D6 Fail-closed auf das Fernmeldewesen

Der Rahmen (`EinsatzLayout`) fängt das gesperrte Modul ab (`ModulGesperrt`). Ist der
Freigabeabruf aber gescheitert, rendert er die Seite unverändert (Spec `modul-freigabe`). Die
Quellen des Funkplans sind Listen anderer Module und prüfen das Fernmeldewesen nicht. Deshalb
behalten beide Seiten eine eigene, fail-closed Prüfung. Dafür wird `useStabFreigabe` zu einem
`useModulFreigabe(key)` verallgemeinert (Zustände `laden | fehler | gesperrt | frei`, Anzeige
„Modul <Label> nicht freigegeben“), und `useStabFreigabe` ruft es mit `'stab'` auf. Ohne Netz
gilt der vorgehaltene Stand der Freigaben (sie sind Rahmendaten von `LAGEBILD_OFFLINE`).

*Verworfen:* die eigene Prüfung streichen, wie die Stellenliste vorschlug. Dann zeigte der
Funkplan bei gescheitertem Freigabeabruf Daten, auch wenn das Fernmeldewesen gesperrt ist.

### D7 Alte Adressen: Weiterleitung nach der Freigabe des Ziels

- `modulAusPfad` kennt zwei Altpfade, `stab/funkplan` und `stab/kommunikationsplan`, und ordnet
  sie `fernmeldewesen` zu, nach dem Vorbild von `PFAD_KEY` (längster Präfix). So gatet der
  Rahmen eine alte Adresse nach dem Ziel. Bei ausgeblendetem Stab läuft die Weiterleitung.
- Kleine Komponente `AltpfadWeiterleitung` mit `<Navigate replace>`. Sie behält `?ansicht=` und
  die übrige Query. `ModulRedirect` taugt nicht, weil es die Query verwirft.
- Die Routen `stab/funkplan` und `stab/kommunikationsplan` bleiben dauerhaft als Umleitung
  (Risiko-Absatz der Herleitung).

*Verworfen:* die Weiterleitung außerhalb des Rahmens. Dann sähe ein Mitglied ohne Freigabe des
Fernmeldewesens kurz die Umleitung statt sofort den einheitlichen Hinweis, und eine zweite
Route-Ebene neben dem Rahmen wäre ein Sonderweg.

### D8 Stab-Daten im Fernmeldewesen: eigene Weiche

- `useNetzQuellen(einsatzId, freigabe)` nimmt die Freigabe des Fernmeldewesens. Nur die Quelle
  `besetzung` fragt zusätzlich `istKeyFreigegeben('stab', freigaben)` ab und ist sonst `gesperrt`.
  Damit geht keine Anfrage an den Stab, und die bestehende Rechteweiche nennt den Grund.
- **Kommunikationsplan:** Ist die Besetzung `gesperrt`, lautet der Nebentext der
  Führungsfunktion „—“ mit dem Grund „Stab nicht freigegeben“ im `title` und für Screenreader.
  Dazu wird `stabZustand` auf der Seite repariert: Eine abgeschaltete Abfrage hieße heute
  „Besetzung lädt“ ohne Ende.
- **Fernmeldeskizze:** Ohne Besetzung trägt der Kasten „Einsatzleitung“ keine Sachgebietszeichen,
  und die Liste der fehlenden Quellen nennt „Stab-Besetzung: nicht freigegeben“. Das ist die
  bestehende Anforderung „Fehlende Quellen werden benannt“. Ein „—“ im Kasten selbst würde den
  Kasten wachsen lassen. Das verbietet „Führungsmittel und Funktionen im Kasten“ („so hoch wie ohne
  diese Anforderung“), und Auto-Layout und Druck müssten mitziehen.
- `recht: 'stab'` wird `recht: 'fernmeldewesen'` (Rechtsquelle, `RECHT_WORT` „Fernmeldewesen“).

### D9 Abnehmer

- `entwurf/DokumentAnlagen.tsx`: `darfAnfuegen` prüft `useModulFreigabe('fernmeldewesen')`.
- `stab/SkizzenAufnahme.tsx`: dieselbe Freigabe, Grund „Fernmeldewesen nicht freigegeben“.
- `lageberichte/fuehrungsproblemeUebernahme.ts`: `funkFrei` hängt an `fernmeldewesen`, der
  Quellname wird „Fernmeldewesen“. Für die Sprechgruppen ist die Freigabe des Fernmeldewesens die
  Voraussetzung, wie bisher die Stab-Freigabe.

### D10 Stab-Seite, Sprungmarken und Palette

- **Stab-Seite:** Die S6-Einträge in `stab/unterseiten.ts` erhalten das Zielmodul
  `fernmeldewesen`. `StabPage` rendert sie wie `LagebesprechungZeile` als `SprungKnopf`, gesperrt
  bei `istSprungGesperrt('fernmeldewesen')`. Bei ausgeblendetem Ziel fehlen sie. Die S5-Einträge
  bleiben `<Link>`.
- **Sprungmarken:** Hinter „Fernmeldewesen“ stehen „Fernmeldeskizze“ (Hinweis
  „Fernmeldewesen · Skizze“) und „Kommunikationsplan“ (Hinweis „Fernmeldewesen ·
  Kommunikationsplan“), Zielmodul `fernmeldewesen`, Kategorie `kommunikation`. Die Marke
  „Funkplan“ entfällt, denn das Modul selbst öffnet den Funkplan. Die Schlagworte („funk“,
  „sprechgruppe“, „tmo“, „dmo“, „s6“) wandern an den Modul-Eintrag der Palette bzw. an die Marken.
  `STAB_SCHLAGWORTE` behält nur S5. Der Test „jede Stab-Unterseite hat genau eine Marke“ wird auf
  S5 und eine zweite Tabelle für das Fernmeldewesen umgestellt.
- **Palette:** „Funk“ trifft das Modul über Label und Beschreibung. Der Test pinnt
  „Fernmeldewesen“ als ersten Treffer. Ids `ansicht:funkplan` im Gedächtnis fallen still heraus,
  wie jede unbekannte Id.

*Verworfen:*
- B, die Marken bleiben hinter „Stab“ mit Zielmodul `fernmeldewesen`. Dann stünden sie bei
  ausgeblendetem Stab ohne Anker und mit falschem Ort in der Kategorie Führung.
- C, alle drei Marken streichen. Der Kommunikationsplan wäre dann nur über das Modul und den
  Reiter erreichbar, zwei Griffe statt einem. Die Palette fände „Kommunikationsplan“ nicht mehr
  als eigenen Treffer.

### D11 Regeln

- `frontend/src/stab/AGENTS.md`:
  - Titel und Geltungsbereich „Stab und Fernmeldewesen“, die Dateien bleiben.
  - Funkplan: „Modulseite `fernmeldewesen` (`funkplanPfad`), Reiter der Hülle; prüft die Freigabe
    des Fernmeldewesens fail-closed selbst (D6)“.
  - Skizze: „Reiter des Moduls, keine eigene Route“.
  - Kommunikationsplan: „Unterroute `fernmeldewesen/kommunikationsplan`, fail-closed auf
    `fernmeldewesen`“.
  - Offline: „offline lesbar als Unter-Key des Fernmeldewesens“.
  - Neu: „Stab-Daten im Fernmeldewesen nur über eine eigene Weiche auf `stab`“ (D8).
  - S5-Abschnitt ohne „(auch Funkplan)“.
- `frontend/AGENTS.md`:
  - „Keine Arbeitsplatzachse“: „Stabsfunktionen und Fernmeldewesen ebenso“.
  - Sprungmarken-Absatz (LLH-1127): S6-Marken hinter „Fernmeldewesen“.
  - Verweisblock Stab nennt das Fernmeldewesen.
- `frontend/src/command-palette/AGENTS.md`: Die Stab-Unterseiten-Zuordnung nennt nur S5.
- `frontend/src/offline/AGENTS.md`: Liste um „Kommunikationsplan (Fernmeldewesen)“ ergänzen.
- Wurzel-`AGENTS.md`: Regelkarte „Stab und Fernmeldewesen: Funkplan, Fernmeldeskizze,
  Kommunikationsplan (S6), Checkliste Arbeitsaufnahme“.
- Code-Kommentare mit Verweis auf geänderte Abschnitte per `grep -rn "stab/AGENTS.md"`.

### D12 Anwenderdoku

- `funkplan.md` wird das Kapitel des Moduls: Titel „Fernmeldewesen: Funkplan, Fernmeldeskizze und
  Kommunikationsplan“, `reihenfolge: 440` bleibt (Paketblock 5, nicht Menükategorie).
  Einstiege über „Kommunikation › Fernmeldewesen“ und die Reiter. „Wer was darf“ nennt die eigene
  Freigabe unabhängig vom Stab und die Besetzung „—“ ohne Stab. `quellen:` um
  `einsatz/modulRegistry.ts` ergänzt.
- `stab.md`: Die Unterseiten-Sperre nennt nur noch S5. Die S6-Zeile springt ins Fernmeldewesen.
  Die Marken unter „Stab“ sind nur noch S5.
- `einsatz-oberflaeche.md` (Marken), `lageberichte.md` und `auftraege-befehle.md`
  („Fernmeldeskizze anfügen“ hängt am Fernmeldewesen), `ohne-netz.md` (Wortlaut prüfen).
- Bilder: `funkplan.bilder.ts` auf die neuen Adressen, erzeugt mit
  `pnpm doku:bilder --grep "funkplan|einsatz-oberflaeche|stab"`, jedes Bild höchstens 300 KB.

## Risks / Trade-offs

- [Ein Einsatz mit ausgeblendetem Stab zeigt nach dem Update das Fernmeldewesen] → gewollt (D7
  der Herleitung). Steht im Versionshinweis (D4).
- [Offener Tab mit altem Bundle] → Die API-Pfade bleiben. Ein alter Tab lädt weiter, hört aber
  bis zum Neuladen auf `stab` statt `fernmeldewesen` und sieht Änderungen anderer erst nach
  Neuladen. Das Frontend ist eingebettet und lädt nach einem Update neu.
- [Schreib-Warteschlange (LFH-705)] → Kommunikationsplan und Skizze gehen nie in die
  Warteschlange (Spec „Bearbeiten ohne Netz gesperrt“). Nichts zu tun.
- [Parallel laufende Changes] LLH-1179 (Org-Sichtbarkeit), LLH-1124 (Stab-Seite) und LLH-1127
  (Palette) berühren `modulRegistry.ts`, `MODUL_KEYS`, `stab/unterseiten.ts`,
  `sprungmarken.ts` und die nächste Migrationsnummer. → Vor dem PR `alpha` mergen, Nummer per
  `scripts/check-migrationen.sh` prüfen.
- [Großer Testumbau] → Etwa 30 Vitest- und 15 e2e-Dateien nennen alte Pfade oder
  „Modul Stab nicht freigegeben“. → Die Pfade kommen aus `funkplanPfad`/`kommunikationsplanPfad`.
  Wo Tests Literale tragen, werden sie Gruppe für Gruppe nachgezogen (tasks.md).
- [Bildlauf in der Cloud-Sitzung] → Bei LLH-1111 lief er. Scheitert er, steht das im PR, und die
  Aufgabe bleibt offen.

## Migration Plan

1. Migration 0185 läuft beim Start (sqlx). Sie fügt nur Zeilen hinzu. Rollback:
   `DELETE … WHERE modul_key = 'fernmeldewesen'` in beiden Tabellen.
2. Backend und Frontend kommen in einem Binary. Die API-Pfade bleiben, also braucht es keinen
   Übergangsweg.

## Open Questions

- **Icon des Moduls.** Vorgelegt am 13.10.2026: Funkmast (radio-tower, 2309), Handfunkgerät
  (walkie-talkie, 1548), Fahrzeugfunk (marine-radio, 1553). Umgesetzt ist die Empfehlung Funkmast
  (`scripts/icons/quellen/funkmast.svg`); wählt Ruben ein anderes, tauscht ein Commit Quelle und
  Register.
