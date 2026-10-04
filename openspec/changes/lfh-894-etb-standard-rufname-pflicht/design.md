# Design

## Context

Motivation: siehe `proposal.md`. Anforderungen: `specs/etb-absender-empfaenger/spec.md` und die
Änderung in `specs/fuehrungsfunktionen/spec.md`.

Heute:
- **Server.** `routes/etb.rs::erfassen` liest `von`/`an` über `bereinige` als `Option` und
  reicht sie an `etb::repo::anlegen_idempotent`. Alle Wege laufen durch den einen INSERT in
  `etb::repo::einfuegen`, der dort schon den Funktions-Snapshot (LFH-615) setzt. Rund 25
  Kopplungspfade bauen `EintragDaten` selbst; nur Meldung (`von` = Absender, `an` = Empfänger),
  Auftrag (`an` = Empfänger-Klartext) und Nachforderung (`an` = Adressat) setzen eine Seite,
  alle übrigen `None`.
- **Präferenzen.** `benutzer_einstellungen` ist ein Schlüssel/Wert-Fach je Person mit Whitelist
  `BEKANNTE_SCHLUESSEL`; der Wert ist für den Server opaker Text (≤ 2000 Zeichen). Der Client
  liest das Fach über `globalKeys.benutzerEinstellungenVon(benutzerId)` (heute nur
  `useZuletztBefehle`), `PUT` antwortet mit dem vollen Stand.
- **Client.** `Schnellerfassung` hält `metadaten` (`von`, `an`, …) als Zustand. Beim ersten
  Mount ohne Entwurf belegt sie „An“ per `anVorbelegung(einsatz)` vor (Führungsstelle → erstes
  Sachgebiet), ebenso `useEtbEntwuerfe` beim ersten leeren Entwurf. Nach dem Absenden wird
  `metadaten` auf `{}` geleert, außer „Werte behalten“ ist an (`nurUebernahme`). Eine
  Berichtigung startet mit leeren Metadaten. `baueEintrag` schickt leere Felder als
  `undefined`.

## Goals / Non-Goals

**Goals:**
- Jeder neue Eintrag hat Von und An, egal über welchen Weg er entsteht.
- Die Vorbelegung lebt nicht im Entwurf, sondern wird beim Anzeigen und Absenden eingesetzt;
  ein Entwurf bleibt damit unvollständig speicherbar und folgt einem geänderten Standard.
- Der Systemfall ist eine Stelle, nicht 25.

**Non-Goals:**
- Kein Nachpflegen alter Einträge, keine DB-Bedingung (`NOT NULL`/`CHECK`): der Altbestand
  bleibt `NULL`, eine Tabellen-Umschreibung in SQLite wäre eine Migration ohne Nutzen.
- Kein Standard je Einsatz (Entscheidung vom 01.10.2026: je Person).
- Keine Änderung an Response-DTOs, am Druck oder an der Anzeige von Von/An.

## Decisions

### D1 Speicherung: ein Schlüssel `etb_standard_rufname` mit JSON-Wert

Neuer Eintrag in `BEKANNTE_SCHLUESSEL`: `etb_standard_rufname`, Wert
`{"von":"ELW 1","an":"ELW 1"}`. Ein Schlüssel statt zwei, weil ein `PUT` sonst beide Seiten nicht
gemeinsam schreibt und ein halber Stand (Von neu, An alt) entstehen könnte. „Empfänger wie
Absender“ wird nicht gespeichert, sondern beim Öffnen der Abfrage aus `von === an` abgeleitet
und beim Speichern als `an = von` geschrieben. Der Server bleibt beim opaken Text (Konvention
LFH-391); der Client liest defensiv: ungültiges JSON oder ein leeres Feld gilt als „kein
Standard“. Keine Migration.

*Verworfen:* zwei Schlüssel `etb_standard_von`/`_an` (nicht atomar); ein Feld am Benutzer
(Migration, und das Fach existiert genau dafür).

### D2 Vorbelegung zur Anzeige- und Sendezeit, nicht im Entwurf

`metadaten` hält weiter nur, was die Person ausdrücklich gesetzt hat. Wirksam ist
`wirksam = { von: metadaten.von ?? standard.von, an: metadaten.an ?? standard.an, … }`, eine reine
Funktion in `schnellerfassungModell.ts`, die Chip-Zeile und `baueEintrag` gleichermaßen nutzen.
Ein Chip aus dem Standard ist als solcher kenntlich (Titel „Standard“) und öffnet beim Klick
den Editor für diesen Eintrag; ein ausdrücklicher Chip lässt sich entfernen und fällt dann auf
den Standard zurück. `@` und `/von`, `/an` schreiben wie bisher in `metadaten`; `atZielFeld`
bleibt unverändert, die andere Seite fällt so von selbst auf den Standard.

Damit ändern sich drei Stellen nicht mehr: das Leeren nach dem Absenden (`{}` heißt jetzt
„Standard“), der Entwurfsspeicher (speichert weiter nur Ausdrückliches) und „Werte behalten“
(`nurUebernahme` behält das Ausdrückliche).

*Verworfen:* den Standard beim Anlegen in den Entwurf schreiben (wie heute `anVorbelegung`).
Er ginge nach dem ersten Absenden verloren, bliebe in alten Entwürfen stehen, und ein
geänderter Standard erreichte offene Entwürfe nicht.

### D3 Vorrangregel wird zum Vorschlag

`anVorbelegung(einsatz)` belegt nicht mehr vor. Die Rufname-Abfrage nutzt ihr Ergebnis als
vorgewählten ersten Vorschlag, die Person bestätigt ihn mit einem Handgriff. Grund: Ein
einsatzgebundener Wert, der still „An“ füllt, widerspräche dem Standard je Person und erzeugte
zwei Quellen für dasselbe Feld. `useEtbEntwuerfe` verliert den Parameter `fuehrungsstelle`,
`EtbEntwurfsTabs` und `Schnellerfassung` die Vorbelegung beim Mount.

*Verworfen:* Führungsstelle schlägt den Standard für „An“ (zwei Regeln für ein Feld, und
Von/An wären bei der Mehrzahl der Vermerke verschieden); Vorrangregel als Rückfall ohne
Standard (dann gäbe es An ohne Von, und die Pflicht würde trotzdem greifen).

### D4 Abfrage inline in der Erfassung, nicht als Modal

Ohne Standard steht über der Eingabezeile eine kompakte Zeile „Dein Rufname für Von und An“ mit
einer Auswahl (`AutoComplete` über Funkrufnamen und Sachgebiete, Freitext erlaubt), dem
Schalter „Empfänger wie Absender“ (Vorgabe an; aus zeigt ein zweites Feld) und „Übernehmen“.
Mit Standard steht in der Hinweiszeile „Von/An: ELW 1 · ändern“; „ändern“ öffnet dieselbe
Zeile vorbelegt. Gründe: Das ETB wird auch gelesen (ein Modal sperrte die Zeitachse); das
Feldbudget der Schnellerfassung bleibt, weil die Zeile nur bis zur Antwort steht; e2e-Specs,
die nur lesen, laufen ohne Standard weiter. Die Zeile erscheint nur mit Schreibrecht im
laufenden Einsatz, nie in einer Berichtigung (dort gilt der vorhandene Standard).

*Verworfen:* `ErfassungsModal` beim Öffnen (blockiert Lesen, jede ETB-e2e-Spec müsste es
wegklicken); eigene Einstellungsseite (der Ticketwunsch ist „im ETB sichtbar und änderbar“).

### D5 Systemeinträge: fehlende Seite wird „System“ — zentral in `einfuegen`

`etb::SYSTEM_RUFNAME = "System"`. `einfuegen` ersetzt ein `None` bei `von` oder `an` durch
diese Kennung, bevor es bindet; ein gesetzter Wert bleibt. Das ist dieselbe Stelle, an der
schon der Funktions-Snapshot sitzt, und jeder Kopplungspfad läuft hindurch. Die Route
`erfassen` prüft vorher die Pflicht, sodass ein Client-Eintrag nie in diesen Rückfall läuft.
Demo-Szenario und Dev-Seeds, die Hand-Einträge nachbilden, bekommen ausdrücklich einen Rufnamen
(„Einsatzleitung“ für Von und An), damit sie nicht wie Systemeinträge aussehen.

**Entschieden vom Auftraggeber am 04.10.2026: Systemkennung.** Verworfene Alternativen, die an
derselben Stelle umsetzbar gewesen wären:
- *Rufname des Auslösers:* `einfuegen` liest den Standard des `erfasser_id` aus
  `benutzer_einstellungen`, Rückfall „System“. Liest sich wie Funkverkehr, behauptet aber bei
  Einträgen wie „Ablösung vollzogen“ einen Funkspruch, den es nie gab.
- *Nur von Hand:* kein Rückfall in `einfuegen`, die Pflicht gilt nur in der Route; die
  Systemszenarien der Spec entfallen.

Gründe für „System“: ehrlich, eine Zeile Logik, und der Auslöser steht schon in
`erfasser_id`/`erfasser_funktion`.

### D6 Pflicht im Server: 400 über `pflicht`

`erfassen` liest `von`/`an` mit `pflicht(…, "Von")` bzw. `pflicht(…, "An")` (fehlend oder leer →
400 `Validation`, Statuscode-Konvention `src/AGENTS.md`). Der Request-DTO behält
`Option<String>`, damit ein fehlendes Feld die eigene Meldung bekommt statt eines
Deserialisierungsfehlers. Die Prüfung steht vor dem Insert und vor der Idempotenzprüfung.

### D7 Pflicht im Client vor dem Absenden

`Schnellerfassung` prüft `wirksam.von`/`wirksam.an` vor `erfassen`. Fehlt eines, wird nichts
gesendet (auch nicht in die Offline-Warteschlange), die Erfassung nennt das Feld
(„Von fehlt: Rufname festlegen oder /von setzen“) und öffnet ohne Standard die Abfragezeile.
Text, Metadaten und Anhänge bleiben. Der Entwurfsspeicher prüft nichts.

## Risks / Trade-offs

- [Offline-Warteschlange mit Einträgen von vor dem Update ohne Von/An] → Sie landen beim Senden
  unter „abgelehnt“ mit der 400-Meldung; „Erneut senden“ hilft nicht. Selten (Update mitten in
  einem Netzausfall), Text bleibt lesbar. Hingenommen und im Abschluss benannt.
- [Fremde API-Aufrufer ohne Von/An] → BREAKING im Proposal markiert; der einzige bekannte
  Aufrufer ist der eigene Client.
- [Viele Rust-Tests posten ETB-Einträge ohne Von/An] → Mechanisch nachziehen (Skript), dann
  gezielte 400-Tests; kein Test-Helfer, der die Pflicht still auffüllt.
- [e2e-Specs, die über die Oberfläche ins ETB schreiben] → Ein Helfer setzt den Standard per
  `PUT /api/benutzer-einstellungen/etb_standard_rufname` nach der Anmeldung; eine eigene Spec
  prüft die Abfrage ohne Standard.
- [Präferenz offline nicht geladen] → Ohne Fach im Cache kein Standard: die Abfrage erscheint,
  die Pflicht hält. Kein stiller Rückfall auf einen Gerätewert.
- [„System“ als Text kollidiert mit einem echten Rufnamen „System“] → Unwahrscheinlich; der
  Erfasser bleibt unterscheidbar. Hingenommen.

## Migration Plan

Keine Datenmigration. Ausrollen mit dem nächsten Release; Rückweg ist ein Revert (der neue
Präferenz-Schlüssel stört eine ältere Fassung nicht, sie kennt ihn nur nicht und lehnt ihn beim
Schreiben mit 400 ab, liest aber weiter).
