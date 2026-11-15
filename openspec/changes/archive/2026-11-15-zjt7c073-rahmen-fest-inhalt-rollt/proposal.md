# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/zjt7c073dbfey86jbvbx1ei1 (LLH-1727, Teil von LLH-1715)

## Why

Auf langen Seiten rollen Modulliste und Seitentitel weg: Das ETB öffnet am Ende der Zeitachse
(gewollt, neueste Zeile über der Erfassung), die zweite Spalte ist dann leer bis auf den Fuß
„Einsatzdauer“, die Überschrift liegt 2 300 px über dem Fenster, und ein Klick auf die
Rail-Kategorie holt die Liste nicht zurück. Dasselbe in Personal, Einstellungen und der
Verwaltung. Wer mitten im Einsatz das Modul wechseln oder die Seitenaktion („Neuer Eintrag“,
„Drucken“) erreichen will, muss erst nach oben rollen.

Heute kleben ab `md` nur die Kopfleiste und ab `lg` die Rail-Kategorien (LFH-952). Das
Modulpanel rollt mit, und den Seitenkopf hält nur das ETB fest (`kopfKlebt`).

## What Changes

- **Modulpanel klebt** ab `lg` wie die Rail: eine Spalte unter der Kopfleiste, so hoch wie das
  Fenster darunter, die bei Platzmangel in sich rollt; der Fuß „Einsatzdauer“ steht am Ende
  dieser Spalte statt am Fensterrand des Dokuments.
- **Seitenkopf klebt** ab `md` auf jeder Einsatzseite (`EinsatzSeite`) und jeder
  Verwaltungsseite (`AdminPage`) unter der Kopfleiste, sofern Kopfleiste und Seitenkopf
  zusammen höchstens ein Drittel der Fensterhöhe nehmen; sonst rollt er wie bisher mit.
- **Die Höhe des klebenden Rahmens** (`--lfh-rahmen-oben`) zählt den klebenden Seitenkopf mit.
  Tabellenköpfe, Filterleisten, klebende Detailspalten, der Fokusabstand und die Alarmkante
  hängen sich dadurch ohne eigene Änderung unter den Seitenkopf. Rail, Modulpanel und das
  Verwaltungsmenü hängen an einer neuen Höhe nur der Kopfleiste (`--lfh-kopf-oben`), damit sie
  nicht um den Seitenkopf nach unten springen.
- Der Sonderweg des ETB (eigene Variable für die Seitenkopfhöhe) geht in der allgemeinen
  Mechanik auf; Filterleiste und Spaltenkopf des ETB kleben weiter unter dem Seitenkopf.
- Unter `md` ändert sich nichts (Handy-Kopfleiste: LLH-1728). Gerätehülle (eigener
  Scrollbereich) und Druck bleiben unverändert.
- Nicht gewählt: ein eigener Scrollcontainer nur für die Inhaltsfläche (Begründung in
  `design.md`).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `einsatztauglichkeit-layout`: Requirement „Der Rahmen bleibt beim Rollen erreichbar“ nimmt
  Modulpanel und Seitenkopf auf (Einsatz und Verwaltung), samt Bedingung für niedrige Fenster
  und der Regel, dass klebende Inhalte unter dem Seitenkopf stehen.

## Impact

- Frontend: `components/rahmenOben.ts` (zweite Höhe, Seitenkopf als Quelle),
  `components/EinsatzSeite.tsx`, `components/AdminPage.tsx`, `einsatz/ModulPanel.tsx`,
  `einsatz/IconRail.tsx`, `einsatz/fussFokusabstand.ts` (entfällt voraussichtlich),
  `admin/AdminLayout.tsx` (`seitenleistenStil`), `etb/etbKopfKleben.ts`, `pages/EtbPage.tsx`,
  `etb/EtbSpaltenzeile.tsx`, `index.css` (Fokusabstand), Guard
  `components/rahmenOben.guard.test.ts`.
- e2e: `e2e/rahmen-stehen-bleiben.spec.ts` erweitert; Fokus- und Rahmenspecs
  (`fokus-verdeckung`, `etb-filterleiste`, `alarm-verdeckung`, `rahmen-cls-dichte`) müssen grün
  bleiben.
- Regeln: `frontend/AGENTS.md` Abschnitt Rahmen („Stehenbleiben, gestuft“, „Wer oben klebt“),
  `frontend/src/etb/AGENTS.md` („Kleben“).
- Kein Backend, keine Migration, keine API. Berührt dieselben Dateien wie LLH-1725
  (Übungsmarke im Rahmen, `EinsatzLayout`/Kopfleiste): beim Zusammenführen auf Konflikte achten.
