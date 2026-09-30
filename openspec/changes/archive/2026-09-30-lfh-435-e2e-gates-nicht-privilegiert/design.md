# Design

## Context

Das Warum steht in proposal.md, die Zusagen stehen in specs/layout-gates-rollen/spec.md. Stand
am 29.09.2026 (Inventar in `pruefliste.md`, entsteht in Aufgabe 1.1):

- Jede Layout-Spec hat ihre eigene lokale `anmelden()` als `admin`. Einen gemeinsamen Helfer
  und `storageState` gibt es nicht. Die Konfiguration kennt ein einziges Projekt `chromium`.
- Nicht-privilegiert laufen heute nur zwei Durchgänge, beide ausschließlich auf `/einsaetze`:
  der LFH-460-Block in `gate1-ueberlauf.spec.ts` und der LFH-337-Test in
  `kopfzeile-schmal.spec.ts`. Der Benutzer ist dort kein Einsatzmitglied.
- Die Rechte leitet `frontend/src/einsatz/schreibrecht.ts` ab:
  - `darfImEinsatzSchreiben`: Einsatzleitung, Führungspersonal oder System-Admin
  - `darfEinsatzLeiten`: Einsatzleitung oder System-Admin
  - `darfVerwaltung`: System-Admin oder Org-`fuehrungskraft`
- Ein Mitglied wird über `PUT /api/einsaetze/{id}/mitglieder/{bid}` mit `einsatz_rolle`
  eingetragen. Das darf nur die Einsatzleitung (der Admin, der den Einsatz anlegt).
- Rollenabhängige Zweige ohne Recht fallen in zwei Sorten: Sie **fügen hinzu** (Rechtehinweis,
  Tag, Sperrgrund) oder sie **nehmen weg** (Erfassungsleiste, Zeilenaktionen, „Neuer Einsatz“).
  Hinzufügen gefährdet den Überlauf. Wegnehmen gefährdet die Aussagekraft, weil ein Gate dann
  schlicht weniger misst.

## Goals / Non-Goals

**Goals:**
- Jedes rollenabhängige Layout-Gate hat mindestens einen nicht-privilegierten Durchgang mit
  tragender Vorbedingung und festgehaltener Mutationsprobe.
- Die Rollenanlage steht an einer Stelle und ist in jeder Spec gleich.

**Non-Goals:**
- Kein Durchlauf jeder Spec in jeder Rolle, etwa als Playwright-Projekt je Rolle. Das
  vervielfachte die Laufzeit auch dort, wo der Zustand nicht von der Rolle abhängt.
- Keine funktionalen Rechte-Tests (403, Sperren im Backend). Die liegen in `tests/*.rs` und den
  funktionalen Specs.
- Keine Modulsperre per Override (`benoetigte_rolle`). Das ist eine eigene Achse, die über
  Mandanten-Einstellungen entsteht und nicht über die Rolle. Sie ist höchstens ein Nachzug (s.
  Open Questions).
- Kein Scan-Guard „jede Spec hat eine Rolle“. Er ließe sich per Kommentar erfüllen und ist
  kein Akzeptanzkriterium. Die Regel steht stattdessen in `CLAUDE.md`, das Inventar in der
  Prüfliste.

## Decisions

### D1 Eine Hilfe `frontend/e2e/rollen-kern.ts`

Sie folgt dem Namensmuster `*-kern.ts` wie `fokus-kern.ts` und `kontrast-kern.ts`. Inhalt:

- `anmeldenAls(page, benutzer, passwort)`
- `anmeldenAlsAdmin(page)`
- `benutzerAnlegen(page, { rolle })` mit eindeutigem Namen aus Zeitstempel und Zufall,
  Rückgabe `{ id, benutzername, passwort }`
- `mitgliedEintragen(page, einsatzId, benutzerId, einsatzRolle)`
- `wechsleZu(page, benutzer)`: API-Logout im geteilten Cookie-Jar, dann Anmeldung über die UI

Die Rollen sind als Literal-Union typisiert (`'beobachter' | 'fuehrungskraft' |
'fuehrungspersonal'`) und auf die Rollenpaare aus der Spec abgebildet. Jede Antwort wird
zugesichert, denn ein still gescheitertes Seeding führt zurück zum Admin-Zustand.

Alternative: Die Hilfen bleiben je Spec lokal. Verworfen, denn das Inventar zeigt fünf
abweichende Kopien, und genau diese Streuung hat die Lücke unsichtbar gemacht.

Die Admin-`anmelden()` der Specs bleiben unangetastet, außer in einer Spec, die ohnehin zur
Hilfe wechselt. Ein flächiger Umbau wäre Rauschen im Diff.

### D2 Sitzungswechsel im selben Kontext, nicht in `newContext()`

Seeding als Admin, dann `wechsleZu` im selben `page`. Damit bleiben `page.route`-Stubs (Wetter
in Gate 1) und `addInitScript`-Einstellungen (Dichte) erhalten. Nach dem Wechsel wird jede Route
frisch mit `goto` angesteuert, so kommt kein Tab mit alter Kennung in den 412-Konfliktdialog
(LFH-387). Das Muster steht seit LFH-337 in `kopfzeile-schmal.spec.ts`.

Alternative: `browser.newContext()`. Verworfen, denn jeder Stub und jedes Init-Skript müsste
umziehen, und das vergisst man leicht.

### D3 Ein Benutzer je Achse, kleinste Matrix

| Rolle | Wo | Deckt ab |
|---|---|---|
| Beobachter (`keiner`/`keine` + `beobachter`) | alle Einsatzrouten, `/einsaetze`, globale Kopfzeile | keine Verwaltung **und** kein Schreibrecht in einem Benutzer |
| Org-Führungskraft | nur `/admin/*`, die sie erreicht | Verwaltung ohne System-Admin (Sperrgründe, Rechtehinweis) |
| Führungspersonal | nur Einsatz-Einstellungen/Module | Schreiben ohne Leiten (`darfEinsatzLeiten` ≠ Schreibrecht) |

`keiner` wird auf `/admin/*` nach `/einsaetze` umgeleitet, `/admin/benutzer` sogar für die
Führungskraft. Diese Routen entfallen deshalb im nicht-privilegierten Durchgang, und das Gate
sichert die Umleitung zu, statt sie zu messen.

### D4 Vorbedingung vor Messung, Anker rollenneutral

Jeder nicht-privilegierte Durchgang sichert vor der Messung zu, dass sein Zweig steht:
Rechtehinweis sichtbar (`role="alert"`, Wortlaut aus `stammdaten/rechteText.ts` bzw.
`SpeicherHinweis`), kein freier Link, Aktion gesperrt (`toBeDisabled`) oder abwesend
(`toHaveCount(0)`). Das Muster steht im LFH-337-Test.

Wo ein Anker in Gate 1 heute ein Schreibelement ist, bekommt der Beobachter einen eigenen Anker
aus gesätem Inhalt. Im ETB zum Beispiel legt der Admin vorab einen Eintrag an, weil
`Inhalt …` fehlt. Die Routenliste bekommt dafür je Eintrag einen optionalen `ankerLesend` und
eine optionale `vorbedingungLesend`. Umsetzung: `gate1Routen` wird eine Funktion von
`(einsatzId, rolle)`.

### D5 Wenn ein neuer Durchgang rot wird

1. Messen und den Verursacher benennen (die Diagnose von Gate 1 liefert Tag, Klasse und
   Breite).
2. **Beheben im Change**, wenn die Korrektur lokal ist: eine Komponente, reine Layout-Eigenschaft
   (Umbruch, `minWidth`, `flexShrink`, Ausblenden unter einer Grenze wie in LFH-337), kein
   Wechsel der Bedienform. Dazu kommt ein Vitest oder die e2e-Zeile als Nachweis im selben
   Commit. Die Spec verlangt Überlauffreiheit, also gehört das Beheben zum Auftrag.
3. **Sonst benannte Freistellung** in `BESTAND_OFFEN` (Gate 1) bzw. als `test.fixme` mit
   Ticketnummer (übrige Specs) plus ClickUp-Ticket über `clickup-task-anlegen`. Eine
   Freistellung ohne Ticket gibt es nicht.

Im Zweifel und bei jeder Änderung an der Bedienform gilt: nachfragen, nicht selbst entscheiden.

### D6 `BESTAND_OFFEN` bekommt `rolle`

`Freistellung.rolle: 'admin' | 'beobachter' | 'fuehrungskraft'`. Der Abgleich läuft über Modul,
Breite **und** Rolle, die Totmeldung ebenfalls. Eine Freistellung für den Beobachter lässt den
Admin-Durchgang damit unberührt, so verlangt es die Spec. Die Liste ist heute leer, eine
Migration fällt also nicht an.

### D7 Testschnitt und Laufzeit

- Gate 1: je Prüfbreite und Rolle ein eigener Test, also `Gate 1 · mobil (390 px) · Beobachter`
  mit eigenem Zeitbudget (`test.slow()`). `mode: 'parallel'` bleibt.
- Gate 3 und die übrigen Specs: je rollenabhängigem Test ein Geschwistertest „… (Beobachter)“,
  kein Umbau bestehender Tests in Schleifen über Rollen. Der Admin-Test bleibt dadurch lesbar,
  und ein Bruch nennt die Rolle im Namen.
- Das Laufzeitdelta von `pnpm e2e` wird vorher und nachher gemessen und in der Prüfliste
  festgehalten. Die Shard-Zahl bleibt, weil das Ruleset die Jobnamen pinnt.

### D8 Mutationsprobe

Je neuem Durchgang: eine Mutation, die **nur** den Nicht-Admin-Zweig verbreitert. Beispiele:

- den Tag „Keine Berechtigung“ unter `lg` wieder mit `nowrap`/`flexShrink: 0` einbauen
- `RechteHinweis` bzw. den Sperrgrund mit `minWidth: 2000` versehen
- die Vorbedingung brechen, indem der Hinweis nicht gerendert wird

Erwartung: Der Nicht-Admin-Test wird rot, der Admin-Test derselben Stelle bleibt grün. Mutation,
Befehl und Ergebnis kommen in `pruefliste.md`. Die Mutation wird nie committet, der Baum ist
nach jeder Probe per `git diff --stat` sauber.

### D9 Ablage

Inventar und Prüfliste liegen in `openspec/changes/archive/2026-09-30-lfh-435-e2e-gates-nicht-privilegiert/`
(`pruefliste.md`), nicht in `docs/superpowers/`. Die Projektregel ist eine Zeile in `CLAUDE.md`
unter „Qualitäts-Gates“ und verweist auf die Hilfe und diese Change.

## Risks / Trade-offs

- [Ein neuer Durchgang deckt einen echten Befund auf, und die Change wächst in Produktcode] →
  D5 grenzt das ein: lokal beheben oder freistellen mit Ticket, sonst nachfragen.
- [e2e-Laufzeit steigt um geschätzt 20–30 %] → nur rollenabhängige Stellen bekommen einen
  Durchgang (D3, D7). Das Delta wird gemessen. Wird es zu groß, dünnt der Beobachter-Durchgang
  in Gate 1 auf 1024 und 390 aus, wo die Zweige am engsten sind, und die Prüfliste begründet
  das.
- [Flakiness durch Sitzungswechsel] → Wechsel nur über API-Logout plus UI-Login mit
  URL-Zusicherung, danach immer frisches `goto` (D2).
- [Beobachter sieht wegen Modulsperre ein Modul nicht] → Ohne Override setzt die Registry keine
  Rolle voraus, der Beobachter sieht also dieselben Module. Die Vorbedingung „Anker sichtbar“
  würde einen Wegfall melden.
- [Gesäter Inhalt für Lese-Anker ändert die Admin-Messung] → Zusätzlicher Inhalt kommt nur
  hinzu, wo er fehlt (ETB-Eintrag). Die Admin-Durchgänge messen danach mit mehr Stoff, und das
  ist schärfer, nicht weicher.

## Open Questions

- Soll die Modulsperre per Override (`benoetigte_rolle`) einen eigenen Durchgang bekommen
  (`nav-schmal`, `lage-dashboard-schmal`)? Das berührt weder Specs noch Aufgabenschnitt dieser
  Change und kann nach dem Merge als Nachzug entschieden werden.
