# Proposal

## Why

Die Schnellerfassung des ETB ist die Kernaufgabe am Fükw und auf dem Führungs-Tablet, das ETB
ist ein unveränderliches Beweisdokument. Der Audit vom 01.10.2026 (Stand `0e8db77`, im Code am
05.10.2026 unverändert) fand vier Mängel, die direkt zu Bruchstücken, Tippfehlern und
Berichtigungen führen:

- **Feldbreite ab `md`:** Das Textfeld misst rund 160 px, obwohl die Zeile 770 bis 870 px breit
  ist. Gestreckt wird die Wurzel des `MarkdownEditor` nur in der gestapelten Form unter `md`.
- **Return auf der Bildschirmtastatur:** Enter ohne Umschalt sendet einen einzeiligen Text sofort.
  iOS und Gboard liefern Return als `Enter`, schon das erste Return legt den Eintrag an. Einen
  Mehrzeiler kann man auf Touch praktisch nicht schreiben.
- **Handschirm beim Öffnen:** Bei 390 × 844 beginnt die angepinnte Leiste bei y = 549, der erste
  Eintrag bei y = 681. Die Seite zeigt beim Öffnen keinen Eintrag. Darüber stehen Druckknopf,
  zweizeiliger Typfilter, „Einsatz abschließen“ und vier gestapelte Filterfelder.
- **Hinweis und Platzhalter:** Der Kurzplatzhalter sagt „/ für Befehle“, „Befehl“ ist aber ein
  Fachobjekt (Aufträge/Befehle). Der Tastaturhinweis hängt an der Breite, nicht an der Zeigerart:
  auf dem Touch-Tablet steht „Cmd/Strg+Enter“.

## What Changes

- **Entscheidung (05.10.2026, D1): Return sendet bei grobem Zeiger nicht.** Mit grobem
  Zeiger (`useViewport().istBeruehrung`) fügt Enter ohne Strg/⌘ einen Zeilenumbruch ein; gesendet
  wird über „Erfassen“ oder Strg/⌘+Enter. Das Textfeld trägt `enterKeyHint="enter"`. Mit feinem
  Zeiger bleibt der Vertrag aus LFH-335 unverändert (Enter sendet einen Einzeiler, Shift+Enter
  neue Zeile, Strg/⌘+Enter sendet auch Mehrzeiler).
- **Feldbreite:** Die `Schnellerfassungszeile` bekommt ein Opt-in, das das Kind der Feldzelle auf
  die volle Zellbreite streckt. Das ETB schaltet es ein; Personen- und Infotelefon-Zeile bleiben,
  wie sie sind (ihr Feld füllt die Zelle schon).
- **Hinweis und Platzhalter nach Zeigerart:** Bei grobem Zeiger nennt die Hinweiszeile keine
  Tastenkombination, sondern „Return neue Zeile · „Erfassen“ sendet“. Der Kurzplatzhalter heißt
  „Inhalt … ( / für Typ & Felder · @ für Einheit )“.
- **Handschirm zuerst die Zeitachse (entschieden 05.10.2026, D4):** Unter `md`
  - stehen „Drucken / als PDF“ und „Einsatz abschließen“ hinter einem Menü „Weitere“ im
    Seitenkopf, die Rückfrage zum Abschließen bleibt;
  - steht der Typfilter einzeilig und rollt waagerecht;
  - stehen Volltext, Zeitraum und Einheit hinter einem Knopf „Filter“ mit der Zahl aktiver
    Filter, der sie aufklappt;
  - startet die Erfassungsleiste eingeklappt (nur Feld, Typ und „Erfassen“). Reiterband,
    Feldzeile und Hinweiszeile erscheinen, sobald der Fokus in der Leiste liegt oder der aktive
    Entwurf Inhalt trägt. Das Feld wird beim Laden unter `md` nicht fokussiert.
- **Nachweis:** Vitest für Tastatur, Hinweis und Platzhalter je Zeigerart; e2e-Layout-Gates für
  die Feldbreite (820, 1180, 1440) und die ersten zwei Einträge auf 390 × 844, auch als Rolle
  ohne Abschließen-Recht, jeweils mit Mutationsprobe.
- **Regel:** `frontend/src/etb/AGENTS.md`, Abschnitt Erfassung, nennt die Zeigerweiche und das
  Einklappen unter `md`.

## Capabilities

### New Capabilities

- `etb-schnellerfassung-tastatur`: Tastaturvertrag der ETB-Schnellerfassung je Zeigerart
  (Enter, Strg/⌘+Enter, `enterKeyHint`) und die Texte, die ihn nennen (Hinweiszeile,
  Platzhalter).

### Modified Capabilities

- `einsatztauglichkeit-layout`: Die Anforderung „Die Erfassungsleiste des ETB lässt die
  Zeitachse sichtbar“ verlangt zusätzlich, dass das Textfeld ab `md` die Zeile füllt und dass auf
  dem Handschirm beim Öffnen mindestens zwei Einträge ganz sichtbar sind.

## Impact

- `frontend/src/etb/Schnellerfassung.tsx`, `frontend/src/etb/Schnellerfassung.test.tsx`
- `frontend/src/components/instrument/Schnellerfassungszeile.tsx` (+ Test),
  `frontend/src/theme/sprache.css`
- `frontend/src/pages/EtbPage.tsx`, `frontend/src/etb/EtbFilterleiste.tsx`,
  `frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx`, `frontend/src/index.css`
- `frontend/e2e/leisten-flaeche.spec.ts` (neue Fälle), `frontend/src/etb/AGENTS.md`
- Sichtbar: breites Textfeld am Fükw und Tablet; auf Touch-Geräten sendet Return nicht mehr; auf
  dem Handy ein ruhiger Kopf und eine schmale Leiste. Kein Backend, keine API, keine Migration.
- **Nicht in diesem Change:** die Infotelefon-Erfassung (gemessen 48 % der Fensterhöhe, unter dem
  Deckel; sie wird nur gemessen und notiert), der Typ-Chip „/meldung“ (Slash-Syntax bleibt), und
  die Erfassung über `components/Erfassung.tsx` (eigener Enter-Vertrag über das native Formular).
