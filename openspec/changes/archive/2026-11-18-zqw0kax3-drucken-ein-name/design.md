# Design

## Context

Bestand (Scope 18.11.2026, Kommentar an LLH-1836) und Motivation: proposal.md. Die Bausteine
gibt es schon:

- `components/druck/DruckKnopf.tsx`: Knopf „Drucken / als PDF“ mit synchronem `vorbereiten`
  (Meldebild, Funkplan, Organigramm klappen damit im selben Zug alles auf).
- `components/druck/useDruckNebenwege.ts`: derselbe Druck als `Nebenweg` für
  `EinsatzSeite.weitere`, bisher nur mit asynchronem `vorbereiten` (Lageplan).
- `components/EinsatzSeite.tsx`: `Nebenweg` (mit `ziel` für Seiten, die etwas öffnen) und
  `NebenwegeImKopf` (ab `md` Knöpfe, darunter ein Auslöser „Weitere“), exportiert für Seiten mit
  eigenem Kopf.
- `components/instrument/Paneel.tsx`: Slot `aktion` im Kopf jedes Paneels.

Die Regel „Kräfteübersicht, Funkplan und Kommunikationsplan tragen keinen Nebenweg im Kopf“
(`frontend/AGENTS.md`) war ein Stand von LFH-963, keine Entscheidung dagegen (dort „nicht in
diesem Change“).

## Goals / Non-Goals

**Goals:**

- Jeder Druckeinstieg trägt einen der zwei Wortlaute und steht im Kopf der Seite oder des Objekts.
- Der Wortlaut steht an einer Stelle im Code, nicht als Literal je Seite.

**Non-Goals:**

- Keine neuen Druckstücke (Einheiten, Fahrzeuge, Meldungen, Lageberichte-Liste bleiben ohne).
- Der Knopf auf den Druckseiten selbst, die Hilfe (`HilfePage`, keine Einsatzseite) und die
  Druckseiten-Titel („… – Druckansicht“) bleiben, wie sie sind.
- Lagekarte, Gefahren, Lagebericht und Befehl sind schon richtig; dort ändert sich nichts.

## Decisions

### D1 Zwei Konstanten, ein Baustein für die Druckseite

`DRUCKEN = 'Drucken / als PDF'` bleibt in `useDruckNebenwege.ts`; daneben kommt
`DRUCKANSICHT = 'Druckansicht'` und `druckansichtVon(dokument) => `${dokument} – Druckansicht``.
Ein Helfer `druckansichtNebenweg({ ziel, navigate, dokument? }): Nebenweg` baut den Eintrag mit
`key: 'druck'`, `ziel` und `onWahl`; ETB, Listen, Person, Einsatzdaten, Schichtplan, Planung,
Auftrag und Registrierliste nutzen ihn. Ein Formtest (`druckWortlaut.guard.test.ts`) greppt
`frontend/src` (ohne Tests und Druckseiten) nach den alten Wörtern „Einsatzbericht drucken“,
„Registrierliste drucken“ und einem Knopf „Drucken“ ohne Zusatz und schlägt an.

Alternative: Literale je Seite angleichen. Verworfen, weil genau das zum heutigen Zustand geführt hat.

### D2 Synchrones Vorbereiten im Nebenweg

`useDruckNebenwege` bekommt `vorDemDruck?: () => void`, das wie `DruckKnopf.vorbereiten` im selben
Zug vor `drucken()` läuft (`useDrucken` löst den Dialog nach dem Commit aus). Das asynchrone
`vorbereiten` (Lageplan) bleibt. Meldebild, Funkplan, Kommunikationsplan und Organigramm reichen
ihr Aufklappen so in den Kopf. `DruckKnopf` bleibt für die Druckseiten und die Hilfe.

Alternative: das asynchrone `vorbereiten` mit `Promise.resolve(true)` benutzen. Verworfen: der Eintrag
stünde kurz auf „läuft“, und der Druck käme einen Takt später, ohne Nutzen.

### D3 Seitendruck in den Seitenkopf

Meldebild, Funkplan und Kommunikationsplan setzen `weitere` ihrer `EinsatzSeite`; die
Werkzeugzeile verliert den Knopf (bleibt sie leer, entfällt ihr `Space`). Das Organigramm ist
eine Ansicht der Seite Einsatzabschnitte: der Nebenweg steht im Kopf der Seite, solange das
Organigramm gezeigt wird; das Aufklappen meldet `Organigramm` über einen Rückruf (`onDruckVorbereiten`
bzw. gehobener Zustand), nicht über einen Knopf in sich selbst.

Schichtplan (Ablösung) und Planung: „Druckansicht“ und „Excel“ sind beide Ausgabewege, sie wandern
zusammen in den Seitenkopf, solange die Ansicht Schichtplan bzw. der Reiter „Plan“ gewählt ist.
`AusgabeKnoepfe` wird zu einem Hook `useAusgabeNebenwege`, der zwei `Nebenweg`e liefert; „Excel“
zeigt Laden über `laeuft` und gesperrt mit Grund im `label` (wie heute als Text daneben, LFH-1079).
Den Fehler der Mappe zeigt die Ansicht weiter an ihrer Stelle (`SpeicherFehler`). „Schichtplan
einlesen“ erfasst und bleibt in der Werkzeugzeile. Die Planung hat einen `AdminPage`-Kopf: dort
steht `NebenwegeImKopf` vor dem Menü der Planung.

### D4 Objektdruck im Kopf des Objekts über `NebenwegeImKopf`

Auftrag und Registrierliste legen `NebenwegeImKopf` in den Slot `aktion` ihres `Paneel`. So gilt
dieselbe Breitenregel wie im Seitenkopf: ab `md` ein Knopf (Link mit Knopfgestalt, Strg/⌘+Klick
öffnet einen Tab), darunter ein Auslöser „Weitere“ mit Namen des Objekts („Weitere zum Auftrag
A-3“, „Weitere zur Registrierung“). Das löst den Grund, warum die Registrierliste in einer eigenen
Zeile stand (bei 390 px kein dritter Knopf im Paneelkopf, Gate 1): unter `md` kommt nur der
schmale Auslöser dazu. Der Sprung „Druckansicht“ am Ende des Auftragsdetails entfällt.

Alternative: Auftrag in den Seitenkopf von „Aufträge/Befehle“. Verworfen (mit Ruben 18.11.2026):
ohne gewählten Auftrag wäre unklar, was gedruckt wird.

### D5 Was ohne Druck bleibt, steht in Regel und Hilfe

`druck/AGENTS.md` bekommt einen Abschnitt „Wortlaut und Platz“ mit den zwei Wörtern, den zwei
Plätzen und der Liste der Module ohne eigenen Druck samt Ersatzweg. `frontend/AGENTS.md`
(Nebenwege) streicht die Ausnahme für Kräfteübersicht, Funkplan und Kommunikationsplan und verweist
dorthin. Die Hilfe `drucken-export.md` nennt Wortlaut, Platz und die Ersatzwege.

## Risks / Trade-offs

- [Druck-Specs suchen den Knopf in der Werkzeugzeile oder unter dem alten Namen] → alle e2e-Specs aus
  `DRUCK_SPECS` und die Bilder-Specs mit `Drucken`/`Druckansicht` im Diff mitziehen; lokal mindestens
  Chromium für die betroffenen Druck-Specs.
- [Paneelkopf der Registrierung am Handschirm zu voll, wenn der Sperrgrund daneben steht] → e2e
  `trefflaeche`/Gate 1 bei 390 px prüfen; reicht es nicht, rückt der Sperrgrund unter den Kopf.
- [Wer den Druck im Meldebild an alter Stelle sucht] → Hilfe und Bilder neu; der Kopf ist der Platz
  aller übrigen Module, der Weg wird also einheitlicher, nicht neu.
- [Ein `aria-label`/Testname hängt am Wort „drucken“] → Tests greifen über Rolle und den neuen
  Namen; der Formtest aus D1 hält neue Abweichungen auf.

## Migration Plan

Reine Oberfläche, keine Daten. Rücknahme durch Revert.
