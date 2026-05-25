# Navigations-Redesign — Drei-Ebenen-Modell mit Einsatz-Workspace

**Datum:** 2026-05-25
**Status:** Design abgestimmt, bereit für Implementierungsplan

## Problem

Die heutige Navigation ist eine flache Top-Leiste (`AppLayout.tsx`): `lifeline-hub` · `Einsätze` · `Benutzer`. „Einsätze" steht dort als primärer Reiter gleichberechtigt neben Modul-artigen Einträgen. Sobald man in einem Einsatz arbeitet (heute nur das ETB unter `/einsaetze/:id/etb`), ist der Wechsel zwischen „im Einsatz" und „Einsatzliste" ein großer, unmarkierter Kontextsprung.

Ein Einsatz besteht künftig aus vielen Modulen (Führung, Kräfte & Mittel, Erfassung, Lage, Kommunikation). Die flache Leiste trägt das nicht. Es braucht eine Informationsarchitektur, die den Einsatz-Kontext sichtbar macht und den Einsatz-Wechsel zu einer ruhigen, sekundären Aktion herabstuft.

## Ziele

- Klares Drei-Ebenen-Modell: **Global/Organisation → Einsatz-Workspace → Modul-intern**.
- „Einsätze" ist nie mehr ein primärer Reiter, sondern Heim-Ebene oder ein Switcher im Einsatz-Header.
- Vollständiges Modul-Gerüst aller geplanten Module ab Tag 1 sichtbar — unfertige als WIP-Stub.
- Tragfähig für ~20 Module ohne überladene Leiste.

## Nicht-Ziele (eigene spätere Specs)

- Innere Implementierung der einzelnen Module (Personen, Einheiten, Lagekarte, Stab, …).
- Datenmodelle für Personen-Lebenszyklus, taktische Einheiten, Ressourcen-Stamm/Disposition.
- Feinkörniges Schreibrechte-/Berechtigungssystem pro Feld oder Aktion.

Diese Spec deckt **Navigation + App-Shell + Modul-Gerüst mit WIP-Platzhaltern** ab. Das bestehende ETB wird in den neuen Workspace eingehängt.

## Navigationsmodell: Drei Kontext-Ebenen

### Ebene 1 — Global / Organisation (kein Einsatz offen)
Heim-Ebene. Topbar: `lifeline-hub` · **Stammdaten** · **Benutzer** · **Profil** (rechts).
Inhalt: Einsatz-Kacheln (aktiv / abgeschlossen) + „Einsatz anlegen".

Globale Bereiche:
- **Stammdaten** — organisationsweiter Stamm an Personal, Fahrzeugen, Einheiten. Quelle für die Disposition in den Einsatz.
- **Benutzer** — Benutzerverwaltung (Bestand, heute `/benutzer`).
- **Profil** — eigener Account / app-weite Einstellungen.

### Ebene 2 — Einsatz-Workspace (innerhalb eines Einsatzes)
Layout-Variante B: **Icon-Rail (Kategorien) + Modul-Panel**.
- Schmale vertikale **Icon-Rail** links: ein Icon je Kategorie (Führung, Kräfte & Mittel, Erfassung, Lage, Kommunikation, Einstellungen).
- Klick auf ein Kategorie-Icon öffnet das **Modul-Panel** mit den Modulen dieser Kategorie.
- Rechts der Modul-Inhalt. Die Karte/Inhalte bekommen damit maximale Breite.
- **Aktiv/inaktiv** wird über Farbe + Hintergrund dargestellt (Tabler-Icons haben nur ein Gewicht).

Der **Einsatzname im Header ist der Switcher** (siehe unten).

### Ebene 3 — Modul-intern
Tabs/Filter innerhalb eines Moduls (z. B. Statusfilter der Personen-Liste). Modulspezifisch, nicht Teil dieser Spec.

## App-Shell & Einsatz-Switcher

- **Global → Einsatz:** Klick auf eine Einsatz-Kachel öffnet den Einsatz-Workspace.
- **Einsatz → Einsatz:** Der Einsatzname im Header ist ein Dropdown-Switcher.
- **Einsatz → Global:** Eintrag „Alle Einsätze …" im Switcher führt zurück zur Heim-Ebene; „Stammdaten" springt in den globalen Stamm.

**Switcher-Dropdown-Inhalt:** alle **aktiven** Einsätze der Organisation, darunter Trenner, dann „Alle Einsätze …" und „Stammdaten".

```
▾ Hochwasser Musterstadt (aktiv)
  MANV B14 (aktiv)
  Sturm Ortsteil Nord (aktiv)
  ──────
  Alle Einsätze …
  Stammdaten
```

## Modul-Inventar (Einsatz-Workspace)

| Kategorie | Module | Status |
|---|---|---|
| **Führung** | Einsatzdaten · Einsatzabschnitte | geplant |
| | Stab | WIP |
| **Kräfte & Mittel** | Einheiten · Personal · Fahrzeuge · Abrollbehälter · Material | geplant |
| **Erfassung** | ETB | **fertig** |
| | Personen · Unfallhilfsstellen · Tiere | geplant |
| | Sachschäden | WIP (optional) |
| **Lage** | Dashboard · Lagekarte · Lageberichte · Kräfteübersicht/Meldebild · Gefahren-/Absperrzonen | geplant |
| **Kommunikation** | Chat · Erinnerungen · Aufträge/Befehle · Meldungen (eingehend) | geplant |
| **Einstellungen** | Einsatzbezogene Einstellungen | geplant |

Kommunikations-Module gelten **pro Einsatz** (kein einsatzübergreifender Chat).

## Tragende Datenkonzepte (Kontext, nicht Scope dieser Spec)

Diese Konzepte begründen die Nav-Struktur und sind für spätere Modul-Specs bindend:

- **Personen** = *ein* Stamm mit Status-Lebenszyklus (vermisst → betroffen → Patient SK I–IV → verstorben). Dieselbe physische Person wandert durch die Zustände; ein Nav-Eintrag „Personen" mit gefilterten Sichten, kein getrenntes Modul je Status. Unfallhilfsstellen bleiben davon getrennt (Struktur/Örtlichkeit), ebenso Tiere.
- **Taktische Einheit** = zentrales operatives Objekt. Bündelt Führer + Mannschaft + ggf. Fahrzeug (Gruppe, Zug, Fußstreife, UAV-Team) und wird einem Einsatzabschnitt zugeordnet. Personal und Fahrzeuge sind Bausteine darin. Schwerpunkt ist die operativ-taktische Führung (EL extern/eigen → Zugführer → Gruppenführer), nicht die Stabsarbeit.
- **Ressourcen-Disposition** = Personal/Fahrzeuge/Einheiten kommen aus dem globalen **Stammdaten**-Pool. Im Einsatz wird ausgewählt, welche „gültig"/aktiv sind, plus Ad-hoc-Ergänzung externer Kräfte (z. B. Feuerwehr).

## Sichtbarkeit & Rollen

**Grundsatz: disabled statt versteckt.** Module und globale Bereiche sind für alle eingeloggten Nutzer sichtbar; fehlende Berechtigung zeigt den Eintrag ausgegraut/gesperrt (🔒) mit kurzem Hinweis, statt ihn zu verbergen. Das hält die Navigation für alle konsistent und macht Funktionsumfang transparent.

Grobe Matrix (Rahmen — einzelne Module verfeinern später):

| Bereich | admin | fuehrungskraft | sonstige (im Einsatz beteiligt) |
|---|---|---|---|
| Benutzer (global) | ✓ | 🔒 | 🔒 |
| Stammdaten (global) | ✓ | ✓ | 🔒 |
| Einsatz anlegen | ✓ | ✓ | 🔒 |
| Einsatz-Workspace-Module | ✓ | ✓ | ✓ (sehen) |

Schreibrechte innerhalb der Module werden modulweise in deren eigenen Specs geregelt. Bestand: `system_rolle` (admin), `org_rolle` (fuehrungskraft), `meine_rolle` pro Einsatz bleiben die Grundlage.

## WIP-Stub-Verhalten

WIP-Module sind **klickbar**. Eine Route existiert und öffnet eine **Stub-Seite** mit WIP-Marker (🚧) und kurzer Beschreibung des geplanten Inhalts. Das setzt „theoretisch schon anlegen" um: Route-Stubs werden jetzt registriert, ein einheitliches `ModulStub`-Element rendert den Platzhalter.

## Routing

Schema: `/einsaetze/:id/<modul>`.

- **Bestand:** `/einsaetze/:id/etb` bleibt unverändert stabil und wird zur ETB-Modul-Route im neuen Workspace. Die bestehenden Tests (`EtbPage.test.tsx`, `EinsaetzePage.test.tsx`, `EtbPage.abschliessen.test.tsx`) und der Navigationsaufruf in `EinsaetzePage.tsx:60` (`navigate('/einsaetze/${id}/etb')`) bleiben gültig.
- **Default-Route:** `/einsaetze/:id` ohne Modul leitet auf **Lage-Dashboard** um. Solange das Dashboard WIP ist, **Fallback auf ETB**.
- Globale Routen: `/` bzw. `/einsaetze` (Heim), `/benutzer`, `/stammdaten`, `/profil`.

## Technik & Komponentenstruktur

- **Icon-System:** `react-icons/tb` (Tabler) wird festgezogen — größte Abdeckung für Fach-Konzepte (Drohne, Fahrzeugtypen, Zonen). Aktuell verwendet der Code keine Icons, daher keine Migration nötig. `@ant-design/icons` bleibt für antd-interne Belange bestehen.
- **Modul-Registry** (neu): eine zentrale Datenstruktur als *single source of truth* für Nav, Routing, WIP-Status und Sichtbarkeit. Jeder Eintrag: `key`, `kategorie`, `label`, `icon`, `route`, `status` (`fertig`/`geplant`/`wip`), `benoetigteRolle?`. Nav-Rail, Modul-Panel und Routen-Registrierung leiten sich daraus ab — Module hinzufügen heißt einen Registry-Eintrag ergänzen.

Frontend-Änderungen (Richtung, Details im Plan):
- `components/AppLayout.tsx` → wird zur **globalen Shell** (Ebene 1, Topbar global).
- Neu: **`EinsatzLayout`** (Ebene 2: Icon-Rail + Modul-Panel + Switcher-Header).
- Neu: **`EinsatzSwitcher`**, **`IconRail`**, **`ModulPanel`**, **`ModulStub`** (Komponenten, je fokussiert).
- Neu: **`modulRegistry`** (Datenstruktur + Sichtbarkeitslogik).
- `pages/EinsaetzePage.tsx` → wird zur **Heim-/Einsatzauswahl** (Kacheln).
- `pages/EtbPage.tsx` → unverändert als ETB-Modul, neu eingehängt unter `EinsatzLayout`.
- `App.tsx` → Routing auf Drei-Ebenen-Schema erweitert.

## Tests

- Bestehende ETB-/Einsatz-Tests müssen grün bleiben (Pfad-Stabilität).
- Neu: Modul-Registry-Logik (Sichtbarkeit/Disabled je Rolle), Switcher-Inhalt (nur aktive Einsätze), Default-Route-Redirect (Dashboard→Fallback ETB), WIP-Stub rendert für `status: 'wip'`.

## Offene Punkte / Folge-Specs

- Je eigene Spec: Stammdaten + Disposition, Personen (Lebenszyklus), Einheiten/Abschnitte, Lagekarte/Dashboard, Stab, Kommunikations-Module.
- Feinkörnige Schreibrechte pro Modul.
