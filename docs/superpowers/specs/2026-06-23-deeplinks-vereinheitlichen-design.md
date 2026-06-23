# Deeplinks modulübergreifend vereinheitlichen — Design (LFH-25)

**Status:** umgesetzt · **Datum:** 2026-06-23 · **Board:** LFH-25 (Epic LFH-61 „UX & Navigation")

## Problem

Modulübergreifende Deeplinks im Frontend waren lückenhaft und uneinheitlich (Befund aus
dem L-1 Karten-Fundament): UHS hat eine saubere Item-Route, Schäden nur einen
nachgerüsteten `?schaden=`-Query-Param-Deeplink, viele Querverweise (Inspector → Fach-Modul,
ETB → betroffenes Objekt, Geschädigt-Bezüge) waren gar nicht per URL adressierbar. Dazu:
keine zentrale URL-Builder-Stelle (Links inline per Template-Literal), uneinheitliche
Route-Param-Namen.

## Scope (entschieden)

LFH-25 liefert **Konzept + Verdrahtung + Robustheit**, **nicht** die Drawer→Vollseiten-
Migrationen (das sind die Geschwister-Tasks LFH-147 Tiere, LFH-148 Schäden, LFH-149
UHS-Tabs). Schäden bleibt also bewusst ein Query-Param-Drawer und wird nur gehärtet, nicht
auf eine Item-Route gehoben.

## Das Muster: Route vs. Query-Param

Wann welche URL-Form ein Detail-/Zielobjekt adressiert — abgestimmt auf die
UI-Form-Leitlinie (Drawer-Nutzung, LFH-19):

| Form | URL | Wann |
|---|---|---|
| **Item-Route** | `/einsaetze/:id/<modul>/:<modul>Id` | Das Modul hat eine **eigene Vollseiten-Detailansicht** (Drawer-Leitlinie: >~5 Felder / Tabs / Workflow). Vorbild: UHS, Bereitstellungsraum, Lagebericht, Befehl, Person. |
| **Query-Param-Selektion** | `/einsaetze/:id/<modul>?<modul>=<id>` | Das Zielobjekt wird **in einer Listenseite** selektiert/hervorgehoben oder als Drawer geöffnet, weil (noch) keine eigene Detail-Route existiert. Bsp.: `?schaden=`, `?einheit=`, `?fahrzeug=`, `?personal=`, `?abschnitt=`, `?meldung=`, `?auftrag=`, ETB `?eintrag=`. |
| **`?neu=1`** | `/einsaetze/:id/<modul>?neu=1` | Schnellerfassung auf der Listenseite fokussieren (kein Objekt-Deeplink). |

**Entscheidungsregel:** Existiert eine Vollseiten-Detailansicht → Item-Route. Sonst →
Query-Param-Selektion auf der Liste. Wird ein Modul später per LFH-147/148/149 auf eine
Vollseite gehoben, wandert sein Deeplink von Query-Param auf Item-Route (Builder kapselt das
an einer Stelle).

## Param-Namens-Konvention

- **Item-Route-Param:** sprechend `:<modul>Id` bzw. `:<modulkürzel>Id` — `:uhsId`, `:brId`,
  `:lbId`, `:personId`, **`:befehlId`**. Der Ausreißer `:bid` wurde auf `:befehlId`
  angeglichen (reiner interner Capture-Name; die URL `/auftraege/befehle/<id>` bleibt
  identisch → Altlinks funktionieren weiter, **kein Redirect nötig**).
- **Query-Selektions-Key:** Modul-Singular — `?schaden=`, `?einheit=`, `?fahrzeug=`,
  `?personal=`, `?abschnitt=`, `?meldung=`, `?auftrag=`, `?person=`; ETB-Eintrag `?eintrag=`.
- **URL-Param = stabile DB-`id`**, nicht eine laufende Anzeigennummer (z. B. ETB `?eintrag=`
  nutzt die Eintrags-`id`, nicht die `lfd_nr`).

## Zentraler URL-Builder

`frontend/src/routing/deeplinks.ts` ist die **maßgebliche Quelle der Wahrheit** für
Einsatz-Deeplinks und der **Zielzustand**: neue Links und alle modulübergreifenden
Querverweise (Inspector, ETB-Backlinks, Geschädigt-Bezüge, NaN-Redirect-Ziele) werden
ausschließlich darüber gebaut. Reine, unit-getestete String-Funktionen (`deeplinks.test.ts`);
Builder gehen von gültigen, positiven Integer-IDs aus.

**Noch nicht vollständig migriert:** einige bestehende gleich-Modul-Inline-Pfade
(Liste → Detail, z. B. `LageberichtePage`, `UnfallhilfsstellenPage`, `PersonenPage`,
`UhsSwitcher`, `PersonDetailDrawer`, `KraefteuebersichtPage`, `MeldungKarte`) bauen ihren
Pfad noch als Template-Literal. Sie sind funktional identisch, aber bei einer Routen-/Param-
Änderung separat nachzuziehen → schrittweise Migration als Folge-Task. Wer eine Route ändert,
prüft daher zusätzlich diese Inline-Stellen, nicht nur `deeplinks.ts`.

Der Lagekarte-Inspector adaptiert das über `frontend/src/pages/lagekarte/markerToUrl.ts`
(dünner Adapter auf die Builder; nimmt den ganzen Marker, weil der `lagemeldung`-Marker auf
die **Quell-Meldung**-ID statt `marker.id` zeigt).

## Robustheit (AK3)

- **`parseRouteId(param)`** (in `deeplinks.ts`): akzeptiert nur positive Ganzzahlen, sonst
  `null` (fängt `''`/Dezimal/Negativ/Nicht-Zahl). Jede Item-Route-Detailseite parst ihren
  Param damit, gatet die Detail-Query (`enabled: id != null`, vermeidet den aussichtslosen
  Request) und macht bei `null` einen `<Navigate replace>` auf die Listenseite (nach allen
  Hooks — Rules-of-Hooks). Eine formal gültige, aber nicht existierende ID (404) bleibt beim
  bestehenden Fehler-Alert.
- **Query-Param-Cleanup:** Der Schäden-Drawer entfernt `?schaden=` beim Schließen
  (`navigate replace`), damit Back/Reload ihn nicht erneut öffnet — analog zum `?neu=1`-Muster.

## Trennung Label vs. URL

`src/chat/bezug.ts` (Label-Auflösung von Bezügen) und der URL-Builder bleiben getrennte
Sorgen (Anzeige-Text vs. Pfad). Wer einen Bezugstyp ändert, muss beide Stellen kennen.

## Bekannte Limitierung

- **ETB-Deeplink auf ältere Einträge:** Die ETB-Liste ist Infinite-Scroll. `?eintrag=<id>`
  lädt ältere Seiten gezielt nach, bis der Eintrag gefunden ist (durch das Pagination-Ende
  begrenzt), und scrollt/hebt ihn dann hervor.
- **Listen-Selektion konsumiert** auf Einheiten (`?einheit=`), Abschnitten (`?abschnitt=`),
  Personal (`?personal=`) und Fahrzeugen (`?fahrzeug=`) — gemeinsamer Hook
  `useQueryParamSelektion` (apply-then-clean). Flach-Tabellen (Personal/Fahrzeuge) heben die
  Zeile hervor + scrollen best-effort (Scroll in jsdom nicht testbar → manuell/e2e).
- **Noch nicht konsumiert (Inspector-Link navigiert nur zur Liste):** Meldungen (`?meldung=`,
  Karten + Tab-Umschaltung) und die Auftrags-Liste (`?auftrag=` aus dem ETB-Backlink). Beide
  als Folge-Task vorgemerkt; der Deeplink-Param ist bereits korrekt vorhanden und
  vorwärtskompatibel.
