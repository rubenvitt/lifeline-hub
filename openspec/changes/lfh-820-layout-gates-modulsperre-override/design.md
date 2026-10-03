# Design

## Context

Das Warum steht in `proposal.md`, die Zusage in `specs/layout-gates-rollen/spec.md`. Stand am
03.10.2026:

- Ob ein Modul gesperrt ist, entscheidet nur der Server (`src/einsatz/berechtigung.rs`,
  `modul_freigabe`). Die Reihenfolge ist: Einsatz-Override, sonst Org-Vorgabe, dazu die
  Admin-Ausnahme. Der Client liest das Ergebnis aus `GET /api/einsaetze/{id}/modul-freigaben`
  (`istModulGesperrt`, `istKeyFreigegeben` in `frontend/src/einsatz/modulRegistry.ts`). Für den
  System-Admin ist kein Modul gesperrt. Ein Admin-Gate kann den Sperrzweig deshalb nie sehen.
- Gesät wird mit `PUT /api/einsaetze/{id}/modul-overrides/{key}` und
  `{ sichtbar: true, benoetigte_rolle: 'admin' }` (Muster in `e2e/fuehrungsfunktionen.spec.ts`).
  `sichtbar: false` würde das Modul ausblenden. Das nimmt eine Zeile weg, statt eine gesperrte
  hinzuzufügen, und ist nicht gemeint.
- Der Sperrzweig fügt etwas hinzu:
  - In der Navigation (`ModulPanel.tsx`, `ModulListe`) wird die Zeile zum gesperrten Knopf mit
    `title="Keine Berechtigung"` und Schloss. Eine Sprungmarke auf ein gesperrtes Ziel verliert
    ihren Pfeil und bekommt das Schloss. `ModulAkkordeon` (Drawer) zeigt nur die Module der offenen
    Kategorie.
  - Im Lage-Dashboard (`LageDashboardPage.tsx`, `LagePaneele.tsx`) wird ein Kennzahlplatz zu
    „—“ mit der Notiz `NICHT_FREIGEGEBEN` („nicht freigegeben“), ohne Link. Gefahren-, Sichtungs-
    und Strompaneel zeigen „Modul … nicht freigegeben.“, und auch der Führungsstand zeigt „—“
    mit Grund. Die Plätze hängen über `QUELL_MODUL` (`useLagebild.ts`) an den Modulen: Betroffene,
    Vermisste und „Verbleib offen“ an `personen`, die Gefahrenmatrix an `gefahrenzonen`, der
    Meldungsstrom an `etb`, Kräfte an fünf Kräftemodulen, „Schäden offen“ an `schaeden`.
- Die Rollen-Hilfe `e2e/rollen-kern.ts` (LFH-435, D1/D2) liefert `wechsleZuRolle(page,
  'beobachter', einsatzId)`. Der Beobachter hat Systemrolle `keiner`, ist also von jeder
  `benoetigte_rolle` (`admin`, `fuehrungskraft`) ausgeschlossen.

## Goals / Non-Goals

**Goals:**
- `nav-schmal` und `lage-dashboard-schmal` messen den Sperrzweig mit tragender Vorbedingung und
  festgehaltener Mutationsprobe.

**Non-Goals:**
- Keine Org-Vorgabe als zweiter Weg zur Sperre. Sie erzeugt im Client denselben Zustand
  (`zugriff: false`), und `e2e/modulfreigabe-org-vorgabe.spec.ts` deckt sie funktional ab. Eine
  Org-Vorgabe gilt zudem für den ganzen Mandanten der Temp-DB und wirkte so auf parallel laufende
  Specs.
- Kein Durchgang „ausgeblendetes Modul“ (`sichtbar: false`). Der nimmt nur weg.
- Kein Override-Durchgang in Gate 1 über alle Routen. Gesperrte Module sind dort nicht erreichbar,
  und die übrigen Seiten zeigen keinen Sperrzweig außer der Navigation, die `nav-schmal` misst.
  Ausnahme ist das Dashboard, das `lage-dashboard-schmal` misst.
- Keine funktionalen Sperr-Tests (403, kein Abruf). Die liegen in `modulfreigabe-org-vorgabe`
  und in den Backend-Tests.

## Decisions

### D1 Ja zur Frage aus dem Ticket: beide Specs bekommen einen Durchgang

Alternativen:
- **Nein, Verdikt „nicht rollenabhängig“ bleibt.** Verworfen. Der Sperrzweig fügt sichtbar Inhalt
  hinzu (Schloss, Grundsatz, „—“ statt Zahl). LFH-435 hat genau diese Art Zweig als Überlaufrisiko
  benannt, und ohne Durchgang misst ihn nichts.
- **Nur `lage-dashboard-schmal`.** Verworfen. Der Drawer ist auf 390 px mit 280 px die engste
  Stelle, an der eine gesperrte Zeile ein zusätzliches Icon trägt.

### D2 Sperre per Einsatz-Override mit `benoetigte_rolle: 'admin'`, Beobachter als Betrachter

Der Override gilt nur für den einen Einsatz, den der Test anlegt, und lässt parallele Specs
unberührt. Als Betrachter dient der Beobachter, weil die Rollen-Hilfe ihn schon hat und er von
`admin` wie von `fuehrungskraft` ausgeschlossen ist. Gesät wird als Admin vor dem Wechsel
(LFH-435, D2). Jede Antwort wird zugesichert, sonst führte ein gescheitertes Seeding still zurück
zum ungesperrten Zustand.

Alternative: Führungspersonal statt Beobachter. Verworfen, denn es brächte nur zusätzlich
Schreibzweige ins Bild, die nichts mit der Sperre zu tun haben.

### D3 Welche Module gesperrt werden

- **`nav-schmal`:** mindestens ein Modul in der Kategorie, die beim Öffnen des Drawers offen ist,
  und, wenn vorhanden, das Ziel einer Sprungmarke dieser Kategorie. So steht die gesperrte Zeile
  ohne weiteren Klick im Drawer. Welche Kategorie das ist, hängt an der Startroute, die der
  Beobachter ohne Schreibrecht sieht. Der Admin-Anker `Inhalt …` (ETB-Erfassung) fehlt dem
  Beobachter. Startroute und Anker legt Aufgabe 2.1 fest, rollenneutral nach LFH-435, D4.
- **`lage-dashboard-schmal`:** `personen`, `gefahrenzonen` und `etb`. Damit sind drei der sechs
  Kennzahlplätze gesperrt (Betroffene, Vermisste und je nach Zuschnitt „Verbleib offen“), dazu
  alle drei Paneele. Das ist der breiteste Sperrzustand mit drei Override-Zeilen. Die übrigen
  Plätze bleiben ungesperrt, so misst das Band beide Arten von Zelle nebeneinander.

### D4 Vorbedingung vor Messung

- Navigation: Die Zeile des gesperrten Moduls ist ein Knopf mit `toBeDisabled()` und dem Titel
  „Keine Berechtigung“. Auf 1024 px gilt dasselbe in der inline stehenden Liste, und der
  Hamburger fehlt (`toHaveCount(0)`).
- Dashboard: Mindestens ein Kennzahlplatz trägt „—“ und „nicht freigegeben“ und ist kein Link.
  Das Gefahrenpaneel zeigt „Modul Gefahren nicht freigegeben.“. Der Admin-Anker „sechs
  Kennzahl-Links“ gilt für den Beobachter nicht, weil gesperrte Plätze keine Links sind. Der
  Beobachter-Anker zählt deshalb alle sechs Plätze (`[data-lfh="kennzahl"]`) und die gesperrten
  getrennt.

### D5 Wenn ein neuer Durchgang rot wird

Es gilt dieselbe Befundregel wie in LFH-435, D5. Zuerst messen und den Verursacher benennen. Ist
die Korrektur lokal (eine Komponente, reine Layout-Eigenschaft, kein Wechsel der Bedienform),
wird sie in dieser Change behoben, mit Vitest oder der e2e-Zeile als Nachweis. Sonst kommt ein
`test.fixme` mit Ticketnummer und ein ClickUp-Ticket über `clickup-task-anlegen`. Bei jeder
Änderung an der Bedienform wird nachgefragt.

### D6 Testschnitt und Mutationsprobe

- Je Spec ein Geschwistertest „… (Beobachter, Modulsperre)“ bzw. im Dashboard je Prüfbreite ein
  Test im bestehenden `describe`, der dieselben Mess-Hilfen (`messen`, `keinWaagerechterUeberlauf`,
  `jedeKennzahlStehtInIhrerZelle`, `messeUeberlauf`) benutzt. Die Admin-Tests bleiben unverändert.
  Das Dashboard teilt heute einen Einsatz über alle Tests (`einsatzId ??=`). Der Sperrdurchgang
  legt seinen eigenen Einsatz an, damit der Override die Admin-Messung nicht berührt.
- Mutationsproben, nie committet, Baum danach per `git diff --stat` sauber:
  - Navigation: Hülle des Schlosses im gesperrten Zweig von `ModulListe` mit `minWidth: 2000`.
    Zweite Probe: `disabled={gesperrt}` auf `false` für die Vorbedingung.
  - Dashboard: der gesperrte Kennzahlplatz bekommt einen Wert mit `minWidth: 2000`. Zweite Probe:
    gesperrter Zweig auf den normalen umgebogen, für die Vorbedingung.
  - Erwartung jeweils: Durchgang mit Sperre rot, Admin-Durchgang derselben Spec grün. Mutation,
    Befehl und Ergebnis stehen in `pruefliste.md` dieser Change.

### D7 Ablage

Die Prüfliste dieser Change (`pruefliste.md`) hält Inventar-Nachtrag, Mutationsproben und Läufe
fest. Die archivierte Prüfliste von LFH-435 bleibt eingefroren. Die Zeile in
`frontend/e2e/AGENTS.md` nennt die Override-Achse und verweist nach dem Archiv auf diese Change.

## Risks / Trade-offs

- [Ein Durchgang deckt einen echten Überlauf im Sperrzweig auf] → D5: lokal beheben oder
  `test.fixme` mit Ticket.
- [Die Kategorie, die beim Öffnen des Drawers offen ist, enthält kein sperrbares Modul] → Der Test
  klappt die Kategorie des gesperrten Moduls per Klick auf und sichert `aria-expanded` zu.
- [Override für ein nicht ausblendbares Modul (`einsatzdaten`, `einsatz-einstellungen`) wird
  abgelehnt oder wirkt nicht] → Solche Module werden nicht gesperrt. Das Seeding sichert die
  Antwort zu und fiele sofort auf.
- [Laufzeit] → fünf zusätzliche Tests mit je einem Einsatz und einem Benutzer, ohne Kartenlast.
  Gemessen wird nur die Laufzeit der beiden Specs vorher und nachher.
