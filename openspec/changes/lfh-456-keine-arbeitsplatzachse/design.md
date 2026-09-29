# Design

## Context

Zur Motivation siehe `proposal.md`. Stand am 29.09.2026 (Worktree auf `origin/alpha`):

- **Rechteachse:** `EinsatzRolle` (`src/einsatz/mod.rs`: `Einsatzleitung`,
  `Fuehrungspersonal`, `Beobachter`), `SystemRolle`/`OrgRolle` (`src/auth/mod.rs`),
  Modulfreigabe (`berechtigung::erlaubte_module`). Im Frontend liest
  `einsatz/schreibrecht.ts` sie aus. Keine davon kennt einen fachlichen Arbeitsplatz.
- **Kontext-Achse (LFH-327):** gilt je Gerät. Theme, Dichte und Helligkeit stehen im
  `localStorage` (`lifeline-hub.theme`, `.dichte`, `.helligkeit`, `theme/ThemeModeProvider.tsx`).
  Die Vorgabe `kompakt` (`DICHTE_DEFAULT`) ist dort als „Fükw-Arbeitsplatz“ kommentiert.
  Gemeint ist das Gerät, nicht die Person.
- **Je Person gespeichert** ist allein das Befehlsgedächtnis der Sprungpalette („Zuletzt“,
  `command-palette/zuletztBefehle.ts`). Es liegt serverseitig, damit am geteilten Fükw die
  nächste Schicht nicht das Gedächtnis der vorigen erbt. Der Schlüsselraum ist geschlossen:
  `benutzer_einstellungen::BEKANNTE_SCHLUESSEL` enthält nur `zuletzt_befehle`, jeder andere
  Schlüssel gibt 400 (`tests/benutzer_einstellungen.rs::unbekannter_schluessel_ist_400`).
- **Startziel:** `standard_modul` ist eine Einstellung **des Einsatzes** und gilt für alle
  Beteiligten (`src/einsatz/einstellungen.rs`, `einsatz/DefaultModulRedirect.tsx`,
  Rückfall `redirectZiel()` = Führung · Überblick). Einen Hebel je Person oder je Gerät gibt
  es nicht. Diese Entscheidung ändert daran nichts.
- **Anders als im Ticket beschrieben** hat die Aufnahme-Route (`personenAufnahmePfad`)
  inzwischen zwei Produktiv-Aufrufer:
  - `pages/uhs/UhsDetailPage.tsx`: „Patient aufnehmen“ als Primäraktion, nur mit
    Schreibrecht und bei UHS-Status `aktiv`, mit `?uhs=<id>`. Das kam mit LFH-341/C6.
  - `pages/lage-dashboard/LageDashboardPage.tsx` (`onAufnehmen`): die Leeraktion
    „Person aufnehmen“ im Sichtungspaneel, das `LagePaneele.tsx` rendert. Sie hängt nicht am
    Schreibrecht, die Zielseite prüft selbst (D2).
- **Präzedenzfälle ohne Achse:**
  - Die Sprungmarken (LFH-620, `einsatz/sprungmarken.ts`) „Patienten“ und „Vermisste“ sind
    Einstiege, die nach Aufgabe geschnitten sind, ohne Modul und ohne Rollenbezug.
  - LFH-46 (`docs/superpowers/specs/2026-09-12-lfh-46-stab-s1-s6-design.md` §7/§8) hat
    Sachgebiete S1–S6 ausdrücklich als „keine Rechte- und keine Arbeitsplatzachse“ festgelegt
    („Kein Arbeitsplatz je Sachgebiet“).

## Goals / Non-Goals

**Goals:**

- Eine Entscheidung, die die nächste Arbeitsplatz-Fläche nicht neu verhandelt.
- Eine Liste der Arbeitsplätze mit ihrem heutigen Einstieg. Lücken werden benannt.
- Ein Auslöser, bei dem die verworfene Variante 2 wieder vorgelegt wird.

**Non-Goals:**

- Kein Code, keine Migration, kein neuer Einstieg. Auch die Sprungpalette bekommt keinen
  Aufnahme-Befehl (Entscheidung D3).
- Keine Transport-Fläche. Die Lücke wird benannt, nicht gefüllt (D4).
- Kein Umbau von `standard_modul` zu einer Einstellung je Person.

## Decisions

### D1 — Keine dritte Bedienachse (Variante 1)

Arbeitsplatz-Flächen bleiben Einzelfälle. Man erreicht sie über Einstiege in bestehenden
Flächen und über eine stabile Adresse, die am Gerät als Lesezeichen liegen kann. Was je
Standort verschieden sein muss (Dichte, Theme, Helligkeit), trägt die Kontext-Achse, und die
hängt am Gerät.

Warum: Im Feld wechseln die Arbeitsplätze die Person, nicht das Gerät. Das Aufnahme-Notebook
an der UHS bleibt dort, die Besetzung wechselt im Schichtbetrieb. Ein Lesezeichen und die
Gerätedichte treffen diesen Fall genauer als eine Wahl, die an der Person hängt. Drei
Flächen zeigen, dass Einstiege ohne Achse tragen: die Aufnahme mit zwei Einstiegen, die
Sprungmarken und der Stab.

Verworfen:

- **Variante 2**, eine wählbare „Arbeitsweise“ nur im Frontend, die Startziel, Primäraktion
  und Modulreihenfolge vorbelegt. Dafür gibt es heute keinen Feldbefund. Sie führte einen
  zweiten Ort für das Startziel ein, neben `standard_modul` am Einsatz, samt Vorrangregel. Die
  Primäraktion wäre nicht mehr aus der Seite ablesbar, sondern aus einer versteckten Wahl, und
  das widerspricht dem Seitenkopf-Vertrag „genau eine Primäraktion“. Jede neue Fläche müsste
  sich außerdem zu jeder Arbeitsweise verhalten.
- **Variante 3**, `EinsatzRolle` um fachliche Werte zu erweitern. Das vermischt „darf
  schreiben“ mit „arbeitet gerade an“, und ein Schichtwechsel würde zur Rechteänderung. Es
  kostet Migration, `tests/enum_wire_kontrakt.rs`, Codegen und eine Zuweisungs-UI. LFH-46 hat
  dieselbe Vermischung für S1–S6 schon ausgeschlossen.

### D2 — Nicht-Zuständigkeit gegenüber der Rechteachse

Sichtbarkeit und Schreibrecht kommen allein aus `EinsatzRolle`, Systemrolle und Modulfreigabe
(`einsatz/schreibrecht.ts`, `berechtigung::erlaubte_module`). Ein Einstieg ist keine
Freigabe. Die Zielseite prüft das Recht selbst: `AufnahmePage` zeigt ohne Schreibrecht
„Keine Schreibberechtigung in diesem Einsatz.“ und keine Maske
(`pages/personen/AufnahmePage.test.tsx`). Der Einstieg darf sich nur zusätzlich am Recht
ausblenden, wie in der UHS-Kopfzeile.

### D3 — Aufnahme-Fall durchgespielt

- Die Einstiege bleiben die UHS-Kopfzeile (LFH-341/C6) und die Leeraktion im Sichtungspaneel.
  Einen rollenbezogenen Einstieg gibt es nicht.
- Wer den ganzen Tag aufnimmt, legt sich die Adresse als Lesezeichen an.
- Die Palette behält „Neue Person erfassen“ für die Einzelerfassung (Liste + Modal). Ein
  eigener Aufnahme-Befehl macht `befehle.test.ts` rot: Dort sind die Liste der
  Schnellaktions-IDs und ihre Ziele per `toEqual` gepinnt. `schnellaktionen.guard.test.ts`
  hält ihn nur so lange fern, wie das Ziel kein `neu=1` trägt. Der Guard prüft je Modul und
  löst keine Routen auf. Ein Ziel `…/personen/aufnahme?neu=1` käme dort also durch.

### D4 — Fachliche Arbeitsplätze und ihr heutiger Einstieg

| Arbeitsplatz | Fläche | Einstieg heute |
|---|---|---|
| Aufnahme/Registrierung (Serie) | `personenAufnahmePfad` → `/einsaetze/:id/personen/aufnahme` | UHS-Kopfzeile „Patient aufnehmen“ (`?uhs=`), Leeraktion im Sichtungspaneel, Lesezeichen |
| Einzelerfassung einer Person | Personenliste + `ErfassungsModal` | Sprungpalette „Neue Person erfassen“ (`personenPfad(…, { neu: true })`) |
| Sichtung | Personen im Sichtungsraster | Sprungmarke „Patienten“ (LFH-620), Sichtungspaneel im Überblick |
| UHS-/BHP-/BTP-Leitung | `uhsDetailPfad` (Grundriss, Belegung) | Modul Unfallhilfsstellen, Sprungpalette |
| Bereitstellungsraum | `bereitstellungsraumDetailPfad` | Modul Bereitstellungsräume (die Palette führt nur das Modul, keine einzelnen Räume) |
| Führungsassistenz | ETB mit Erfassungsleiste, Stab (`stabPfad`), Überblick als Startseite | Modulnavigation, Sprungpalette, `standard_modul` des Einsatzes |
| Transportorganisation | **keine eigene Fläche** | Transport ist eine Verbleib-Art der Person (`personen/verbleibErfassungKern.ts`). Die Bilanz „Transportiert / offen“ steht im Sichtungspaneel |

Die Transport-Lücke bleibt stehen. Eine eigene Fläche braucht einen Feldbefund und ein eigenes
Ticket. Sie ist kein Grund für eine Achse.

### D5 — Wiedervorlage von Variante 2

Variante 2 wird neu vorgelegt, wenn **eine** dieser Bedingungen belegt ist:

- Ein Feldbefund zeigt, dass eine Person auf einem **geteilten** Gerät wiederholt zwischen
  Arbeitsplätzen wechselt und Lesezeichen und Einstiege dafür nicht reichen.
- Ein dritter Einstieg in dieselbe Arbeitsplatz-Fläche wird nötig, weil die Fläche von
  mehreren Stellen aus gesucht wird.

Eine Anforderung, die Rechte vom Arbeitsplatz abhängig machen will, fällt nicht darunter. Sie
gehört an die Rechteachse und wäre eine eigene Entscheidung gegen D2.

### Belege je Szenario

| Szenario | Beleg |
|---|---|
| Gleiche Rechte, gleiche Bedienung | Kein Test. Getragen durch Review: `redirectZiel`/`aufloeseStandardModul` (`einsatz/modulRegistry.ts`) nehmen keinen Benutzer, `meine_rolle` liest nur `einsatz/schreibrecht.ts`. Ein Test wird bewusst nicht gebaut, weil eine Abwesenheit über alle Seiten keinen scharfen Guard hat |
| Es gibt keine Arbeitsplatzwahl | Serverseitig `tests/benutzer_einstellungen.rs::unbekannter_schluessel_ist_400` (geschlossener Schlüsselraum). Im Gerät (`localStorage`) nur durch Review |
| Einstieg gewährt kein Schreibrecht | `pages/personen/AufnahmePage.test.tsx` (Beobachter: „Keine Schreibberechtigung“, keine Maske) |
| Aufnahme aus der Unfallhilfsstelle / Keine Aufnahme in einer geplanten UHS | `pages/uhs/UhsDetailPage.test.tsx` (LFH-341 · H38) |
| Aufnahme aus dem leeren Sichtungspaneel | `pages/lage-dashboard/LageDashboardPage.test.tsx` (Leeraktion „Person aufnehmen“) |
| Lesezeichen auf die Aufnahme | `pages/personen/AufnahmePage.test.tsx` (rendert unter `/einsaetze/:id/personen/aufnahme`) |
| Palette führt zur Einzelerfassung | `command-palette/befehle.test.ts` (Ziel-Pin), `pages/PersonenPage.test.tsx` (`?neu=1` öffnet die Maske) |

## Risks / Trade-offs

- [Eine Person muss ihren Arbeitsplatz selbst finden] → Die Einstiege sitzen dort, wo die Arbeit
  anfällt (UHS-Kopf, Überblick), und die Adresse ist stabil. Reicht das nicht, greift D5.
- [Das Ticket ging von null Aufrufern aus, die Lage hat sich seitdem verschoben] → Der Stand ist
  in Context belegt. „Belege je Szenario“ nennt die tragenden Tests. Fällt ein Einstieg weg,
  wird sein Test rot.
- [Die beiden Abwesenheits-Szenarien haben keinen Test] → Getragen durch den geschlossenen
  Schlüsselraum am Server und durch Review. Eine Arbeitsweise im `localStorage` fiele erst im
  Review auf.
- [Die Kontext-Achse wird als „Arbeitsplatz“ missverstanden, siehe Kommentar in
  `ThemeModeProvider.tsx`] → Der CLAUDE.md-Absatz sagt ausdrücklich, dass das Gerät gemeint ist.
