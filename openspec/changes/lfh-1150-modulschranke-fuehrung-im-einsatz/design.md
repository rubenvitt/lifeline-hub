# Design

## Context

Die Modulfreigabe hat eine einzige Auswertung, `modul_freigabe` in `src/einsatz/berechtigung.rs`.
Sie bekommt Override-Map, Org-Vorgaben, Modul-Key und den `Benutzer`, aber **nicht** die Rolle im
Einsatz. Deshalb kann die Stufe `fuehrungskraft` nur `Benutzer::ist_hoehere_berechtigung()`
(System-Admin oder Org-Rolle Führungskraft) prüfen. Das Rollenvokabular wurde in LFH-132 bewusst
an die System- und Org-Rolle gebunden (`docs/superpowers/plans/2026-06-19-lfh-132-modul-sichtbarkeit-override.md`).

Die Einsatzrolle liegt an jedem Aufrufer schon vor:

- `EinsatzKontext.rolle` (Extractor, `src/einsatz/kontext.rs`). Bei einem gekoppelten Gerät steht
  dort die Ansichtsrolle (`Funktionsansicht::rolle()`), daneben `EinsatzKontext.geraet`.
- `routes/vorlagendokument.rs` lädt sie selbst per `einsatz_repo::rolle_von`.
- `fuehrung/aufloesung.rs::laden_fuer` bekommt nur den `Benutzer` und muss die Rolle durchreichen.
- `gesperrt_fuer_einfaches_mitglied` simuliert ein Gerät als Mitglied ohne Rollen.

Motivation und Entscheidung des Menschen: siehe `proposal.md`, „Why“.

## Goals / Non-Goals

**Goals:**

- Eine Stufe, die die Einsatzleitung setzen kann, ohne sich selbst auszusperren.
- Gespeicherte Werte behalten ihre Wirkung; keine Schranke wird still gelockert.
- Weiterhin genau eine Auswertung der Regel (Spec `modul-freigabe`, „Zugriff folgt derselben
  Regel wie die Listen-Endpunkte“).

**Non-Goals:**

- Keine feinere Stufe nur für die Einsatzleitung. Wer das braucht, meldet es als eigenen Task.
- Keine Änderung an Lese- und Schreibrecht im Einsatz; die Modulsperre bleibt eine zusätzliche
  Verschärfung danach.
- Kein Umbenennen des gespeicherten Werts `fuehrungskraft`.

## Decisions

### D1 Eigene Stufe statt Bedeutungswechsel von `fuehrungskraft`

Neuer Wert `einsatzfuehrung`. `fuehrungskraft` bleibt bei der Org-Rolle.

- *Verworfen: `fuehrungskraft` bezieht die Einsatzrolle ein.* Weniger Vokabular, aber jede schon
  gesetzte Schranke ließe nach dem Update mehr Personen herein, ohne dass jemand es bemerkt.
- *Verworfen: nur umbenennen.* Benennt die Falle, löst sie aber nicht: die Einsatzleitung hätte
  weiter keine Stufe, die ihr Führungspersonal einschließt und Beobachter aussperrt.

Der Wert heißt `einsatzfuehrung` und nicht `fuehrung_im_einsatz`, passend zu den übrigen
einwortigen Werten (`admin`, `fuehrungskraft`).

### D2 Wer die Stufe passiert

System-Admin (wie bisher immer vorab durch) · org-weite Führungskraft · Einsatzrolle
`Einsatzleitung` oder `Fuehrungspersonal`. Die Stufe ist damit eine echte Obermenge von
`fuehrungskraft`, und die Rangfolge der Auswahl liest sich von offen nach eng: Frei → Führung im
Einsatz → Führungskraft der Organisation → Admin.

Die Org-Führungskraft bleibt drin, obwohl sie im Einsatz nicht Mitglied sein muss: sie darf den
Einsatz der eigenen Org lesen (`darf_lesen`), und eine Stufe „Führung“, die die Org-Führung
aussperrt, wäre die nächste Falle. Die Org-Isolation trägt weiter das Lese-Gate davor.

### D3 Die Einsatzrolle als Eingabe der einen Auswertung

`modul_freigabe` bekommt einen Parameter `einsatz_rolle: Option<EinsatzRolle>` und wertet
`einsatzfuehrung` dort aus. Ebenso `fordere_modul_zugriff`, `fordere_modul_zugriff_laden`,
`modul_freigaben` und `erlaubte_module`. Der Compiler findet so jeden Aufrufer.

- *Verworfen: eigene Prüfung im Extractor neben `modul_freigabe`.* Das wäre die zweite Auswertung,
  vor der der Kommentar an `erlaubte_module` warnt: Zähler und Live-Feed würden dann ein Modul
  anders sehen als der Listen-Endpunkt.

### D4 Ein Gerät reicht keine Einsatzrolle in die Modulfreigabe

`EinsatzKontext` bekommt eine Methode `modul_rolle()`, die bei einem Gerät `None` und sonst
`self.rolle` liefert. Alle Modul-Gates des Kontexts benutzen sie. Die Ansichtsrolle eines Geräts
(`Fuehrungspersonal` für UHS-Tablet, Betreuungsstelle usw.) ist ein technisches Schreibrecht an
einer Stelle, keine Person in Führung; ein Modul, das die Einsatzleitung auf die Führung
beschränkt, soll kein Stationsgerät öffnen. `gesperrt_fuer_einfaches_mitglied` gibt deshalb
`None` weiter und nennt die neue Stufe in der Geräteverwaltung als Sperre, wie heute
`fuehrungskraft`.

- *Verworfen: Gerät mit Ansichtsrolle.* Konsistent zur Schreibberechtigung, öffnet aber jedes
  Führungs-Modul für Geräte, die die Einsatzleitung als Station und nicht als Führung gekoppelt
  hat.

### D5 Benennung in der Oberfläche

`ROLLEN_OPTIONEN`: „Frei (alle)“, „Führung im Einsatz“, „Führungskraft der Organisation“,
„Admin“. Der Org-Vorgabe-Hinweis in `EinsatzModule.tsx` (`orgRollenHinweis`) nimmt dieselben
Namen aus dieser Liste statt eigener Literale, damit die Namen nur einmal stehen. Die Rollenspur
der `ModulEinstellungsListe` (heute `12 × fontSize`) wird so breit, dass „Führungskraft der
Organisation“ nicht abgeschnitten wird; der bestehende Test der Spurvorschrift pinnt den neuen Wert.

Das Frontend-Typfeld `benoetigte_rolle` in `api/types.ts` erweitert die Union um
`'einsatzfuehrung'`. Das generierte Schema bleibt `string | null`; `check-typ-codegen.sh` läuft
trotzdem, weil sich der Doc-Kommentar am DTO ändert.

### D6 Ein unbekannter Rollenwert sperrt

Heute fällt jeder Wert außer `admin` und `fuehrungskraft` in `modul_freigabe` auf frei. Die
Schreibwege lassen keinen anderen Wert zu, aber genau diese Änderung führt einen neuen Wert ein,
und ein Rückweg auf eine ältere Version ließe ihn als „frei“ stehen. Der Match bekommt deshalb
einen ausdrücklichen Zweig `None => true` und für jeden unbekannten Wert `Some(_) => false`
(nur System-Admin, der vorab durch ist). Das schützt künftige Stufen; für den Rückweg auf eine
Version vor dieser Änderung gilt der Migrationsplan unten.

## Risks / Trade-offs

- [Drei Stufen mit „Führung“ im Namen verwirren] → Reihenfolge von offen nach eng, und die
  Anwenderdoku erklärt den Unterschied an genau einer Stelle („Was ‚Sichtbar‘ und ‚Benötigte
  Rolle‘ bewirken“), auf die „Verwaltung“ verweist.
- [Ein vergessener Aufrufer prüft ohne Einsatzrolle und sperrt die Einsatzleitung weiter aus] →
  Der Parameter ist Pflicht (kein Default), der Compiler meldet jeden Aufrufer; ein
  Integrationstest prüft Liste, Freigaben, Zähler und Live-Filter für dieselbe Einsatzleitung.
- [Ältere Clients kennen `einsatzfuehrung` nicht] → Das Feld ist im Schema schon ein freier
  String; ein alter Client zeigt den Wert schlimmstenfalls leer in der Auswahl. Server und
  Frontend werden zusammen ausgeliefert (eingebettetes Bundle), die Lücke betrifft nur offene
  Tabs bis zum Neuladen.
- [Breitere Rollenspalte kostet Platz bei schmalem Fenster] → Der Spurtest bei 1280 px bleibt
  der Maßstab; bricht der Name dort, wird die Spalte nicht schmaler, sondern der Hinweis darunter
  bricht um (bestehendes Verhalten der Liste).

## Migration Plan

Keine Datenmigration: `benoetigte_rolle` ist `TEXT`, gespeicherte Werte bleiben gültig. Rollback
heißt Revert; ein dann gespeichertes `einsatzfuehrung` fiele in `modul_freigabe` auf den
`_ => true`-Zweig (frei) zurück. Das ist eine Lockerung, deshalb steht im Rückweg: vorher die
Overrides mit `einsatzfuehrung` auf `fuehrungskraft` oder frei umstellen.
