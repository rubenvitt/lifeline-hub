# Prüfliste Einsatztauglichkeit: Kommunikationsplan und Darstellung „Sprechgruppen“ (LFH-848)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Specs liegen daneben
(`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/stab/kommunikationsplan` (neu) und `/einsaetze/:id/stab/funkplan`, Darstellung „Sprechgruppen“ (`?ansicht=sprechgruppen`) |
| Stand | Branch `claude/project-thread-jr228d`, PR gegen `alpha` |
| Zielkontext | Fükw (primär: nachschlagen „welche Nummer hat …?“, pflegen, drucken, Aushang), Führungs-Tablet (lesen, anrufen). Mobil: lesen und wählen (`tel:`) |
| Nicht enthalten | Die eigene Führungsstelle als Zeile ([LFH-849](https://app.clickup.com/t/123zgec5xhy), Kommentar mit dem Nachzug dort). Übernahme in den Lagebericht (D6, bewusst). Pflege von Abschnitt und Einheit (an ihrem Datensatz) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Messung vor dem Bau (`e2e/kommunikationsplan.spec.ts`, Fükw) | Contentbreite 1050 px, Zellpolster 22 px; Funktion „Führungshilfspersonal · Lagekartenführer“ 262 px, Rufnummer (Mono 14) 136 px, Hinweis mit 60 Zeichen 388 px. Spalten 260/180/160 + `mindestBreite` 300 = 900 px (design.md, Nachträge) |
| `e2e/kommunikationsplan.spec.ts` | Fükw ohne Überhang von Tabelle und Seite, Lücke „Leitstelle“ im ersten Bild (`toBeInViewport`); 390 px Tabelle mit fixierter, klebender Kopfzelle „Stelle“; Leitstelle und Verbindung über die Masken angelegt, die zweite Seite zeigt sie live mit `tel:`-Verweis, die Lücke schließt sich auf beiden; Druck bei 680 px ohne Aktionsspalte, ohne sichtbaren Knopf, nichts über der Druckwurzel. `--repeat-each=5 --workers=2 --retries=0`: 20/20 grün |
| `e2e/kommunikationsplan-offline.spec.ts` | Prod-Bundle, Netz weg, Neuladen: Nummer steht, Besetzung „nicht geladen“, „Stand … · offline“, „Stelle hinzufügen“ und „+ Verbindung“ gesperrt. Vorbedingung: der Plan liegt in der IndexedDB, vom Stab NUR dieser Unter-Key |
| `e2e/funkplan.spec.ts`, Darstellung „Sprechgruppen“ | Umschalten, Teilnehmer mit Verweis, kein Überhang am Fükw, Lücken im ersten Bild; A4-Druck mit Druckkopf „Funkplan – Sprechgruppen“, Bedienung aus, kein Überhang |
| `e2e/gate1-ueberlauf.spec.ts` | Route `stab/kommunikationsplan` aufgenommen (Admin, Beobachter mit Vorbedingung „kein ‚Stelle hinzufügen‘“, Führungskraft) |
| `e2e/gate3-trefflaeche.spec.ts` | Neu: „Kommunikationsplan (Admin)“ und „(Beobachter)“: Nummern- und Titel-Links, Drucken, „Stelle hinzufügen“, „+ Verbindung“, Menüauslöser halten 30/48/72 px |
| Rust | `tests/stab_kommunikationsplan.rs` 16 Tests (Statuscodes 400/404/409/422, Reihenfolge, Mandantenlabel, Live-Ereignis `stab` und nie `etb`, Beobachter, fremde Org, abgeschlossener Einsatz, Schwärzung), Wire-Kontrakt beider Enums, Katalog-Guard für die CHECK-Liste, Registry-Guards; `cargo test --lib` 2368 grün |
| Vitest | `stab/kommunikationsplan.test.ts` (13), `stab/luecken.test.ts` (Lücke „Leitstelle“), `pages/KommunikationsplanPage.test.tsx` (21), `pages/kommunikationsplanPrint.test.ts`, `stab/sprechgruppenplan.test.ts` (15), `pages/FunkplanPage.test.tsx` (+9), Guards (`datensicht`, `lagebildOffline`, `queryKeys`), Deeplinks, StabPage |

### Mutationsproben (jede rot, dann zurückgesetzt und grün)

| Nr. | Mutation | Rot |
| --- | --- | --- |
| 1 | Lücke „Leitstelle“ meldet ohne geladene Stellen „fehlt“ | `luecken.test.ts` „behauptet ohne geladene Stellen nichts“ |
| 2 | Besetzungstext übernimmt `telefon` aus dem Datensatz | `kommunikationsplan.test.ts` „übernimmt keine Telefonnummer aus dem Personal“ |
| 3 | `tel:` auch für Fax | 2 Kern-Tests, 1 Seitentest |
| 4 | Unter-Key fehlt in `LAGEBILD_OFFLINE` | `lagebildOffline.guard.test.ts` |
| 5 | Aktionsspalte auch im Druck | `kommunikationsplanPrint.test.ts` |
| 6 | Stelle mit Verbindungen ohne Rückfrage entfernen | Seitentest „nennt ‚2‘“ |
| 7 | vergebene Funktion nicht ausgegraut | Seitentest „graut … aus“ |
| 8 | Besetzung ohne Netz bleibt „lädt“ | Seitentest „nicht geladen statt ewig lädt“ |
| 9 | Schwärzung behält `wert` | `stab_kommunikationsplan::schwaerzung_nimmt_name_und_nummer_und_behaelt_das_skelett` |
| 10 | Sprechgruppen ohne eigenen `key` je `Datensicht` | `datensicht.guard.test.ts` („2 Sichten, davon 1 ohne key“) |

---

## Tabelle: Kommunikationsplan

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Wählbare Nummern über `stabZeilenzielStil`, Titel-Links aus `Datensicht`, Knöpfe und Menüauslöser halten 30/48/72 px (Gate 3, auch als Beobachter) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size`; `Space size="middle"` hält ≥ 16 px zwischen „+ Verbindung“ und Menü (LFH-653). Gate 3 misst die Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Masken zeigen `loading` am Knopf, Fehler IN der Maske (`SpeicherFehler`, Felder bleiben); Entfernen-Fehler an der Seite; die Rückfrage trägt `confirmLoading` | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Stelle mit Verbindungen: Rückfrage mit Zahl („ihre 2 Verbindungen“, Dialog statt `Popconfirm`, design.md Nachträge). Eine Verbindung oder eine leere Stelle geht ohne Rückfrage: ein Feld, Wiederanlegen zumutbar (D5) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Nebentext und Mittel in `rollen.gedaempft`, Nummern als Link in `bedienText`, keine eigene Farbe; Druck dunkel auf hell (`druck.css`) | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „Leitstelle: keine Verbindung erfasst“, „— · nicht geladen“, „keine erfasst“, „Besetzung nicht geladen“ als Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau nur für Bedienziele (Nummern, Titel-Links), Rot nur am OK der Rückfrage und am Menüeintrag „Stelle entfernen“ | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Lücke „Leitstelle“ im ersten Bild bei 1366 × 768 mit offenem Panel (e2e) | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung, keine Toasts; die Quittung ist die neue Zeile | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | Live hinzukommende Stellen (Ereignis `stab`) schieben die Zeilen darunter, wie im Funkplan. Bedienziele je Zeile sind „+ Verbindung“ und ein Menü; ein Fehlgriff öffnet eine Maske, die nichts ohne Absenden ändert | [LFH-867](https://app.clickup.com/t/123zgec64ta) |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte Leiste; Masken sind Dialoge | — |
| 14 | **Tabellenseite vollständig** | **erfüllt** | `form="tabelle"` in jeder Breite (`NUR_TABELLE`), fixierte Spalte „Stelle“, stehende Kopfzeile, kein Überhang bei 1366/390 px (e2e, Gate 1). Keine Suche und Sortierung: die Ordnung ist die feste Gruppenfolge, der Plan ist klein | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | `ErfassungsModal`: Fokus im ersten Feld, Enter sendet, Escape bricht ab und leert; Verbindung im Serienmodus mit „Werte behalten“ für das Mittel; Bezeichnung nur, wo Pflicht (ausgeblendet statt leer); Bearbeiten vorbelegt, schickt nur Geändertes | — |

**Bilanz:** 13 erfüllt · 1 offen ([LFH-867](https://app.clickup.com/t/123zgec64ta)) · 1 nicht anwendbar.

## Tabelle: Funkplan, Darstellung „Sprechgruppen“

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Teilnehmer-Links über `stabZeilenzielStil`, Umschalter über `Segmentleiste` (Gate 3, Funkplan) | — |
| 2 | **Handschuh-Modus** | **erfüllt** [abgeleitet] | Keine eigene Größe; dieselben Bausteine wie Tabelle und Skizze | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Umschalten lokal und sofort; die Übernahme wie bisher mit `loading` | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Schreibgeschützt | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Nur `rollen`-Farben, „keine“ und Gründe gedämpft | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „keine“, „unvollständig · …“, „— · nicht geladen“ als Wort | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau nur für Bedienziele | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Lücken-Paneel bleibt im ersten Bild (e2e) | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Meldung | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | Wie Tabelle und Skizze: live hinzukommende Zuordnungen verschieben Zeilen | [LFH-867](https://app.clickup.com/t/123zgec64ta) |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine schwebende Leiste | — |
| 14 | **Tabellenseite vollständig** | **erfüllt** | `form="tabelle"`, fixierte Spalte „Sprechgruppe“, Σ 930 px am Fükw ohne Überhang, A4 ohne Überhang (e2e) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Schreibgeschützt; zugeordnet wird an Abschnitt und Einheit, die Teilnehmer führen dorthin | — |

**Bilanz:** 11 erfüllt · 1 offen ([LFH-867](https://app.clickup.com/t/123zgec64ta)) · 3 nicht anwendbar.
