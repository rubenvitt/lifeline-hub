# CMD+K-Command-Palette für Module & Schnelleinstellungen (LFH-11)

**Status:** Design abgenommen · **Epic:** LFH-61 (UX & Navigation) · **Datum:** 2026-06-22

## Kontext & Ziel

Im Lifeline-Hub wachsen Module und Schnellaktionen stetig. Eine zentrale
Command-Palette (CMD+K / STRG+K) gibt Führungskräften und Sichtern schnellen
Tastaturzugriff auf Modul-Wechsel, häufige Aktionen und Einstellungen — ohne Maus,
ohne tiefe Menüs. Sie öffnet sich als Overlay aus jeder Ansicht, durchsucht alle
Kategorien per Substring/Fuzzy und respektiert Rollen-/Org-Berechtigungen.

## Akzeptanzkriterien (aus LFH-11)

1. CMD+K (Mac) und STRG+K (Win/Linux) öffnen die Palette aus jeder Ansicht.
2. Suche filtert über alle Kategorien hinweg per Substring/Fuzzy.
3. Auswahl per Enter führt die Aktion aus / navigiert zum Modul.
4. ESC schließt die Palette ohne Side-Effects.
5. Einträge respektieren Rollen-/Org-Berechtigungen (keine Aktionen sichtbar, die der
   User nicht ausführen darf).
6. Funktioniert auch bei offenem Drawer/Modal (Palette legt sich darüber, ohne den
   Unterbau zu zerschießen).

## Scope (abgestimmt)

**Drin:** Hotkey-Overlay · Modul-Navigation · Schnellaktionen (Top 4) · Schnelleinstellungen
(Theme, Koordinatensystem) · Einsatz-Wechsel · globale Navigation · Fuzzy-Suche (Fuse.js) ·
Tastatur-Navigation · Rollen-/Org-Filter (gesperrt = **ausgeblendet**).

**Bewusst draußen (YAGNI):** Dichte-/Compact-Einstellung (existiert heute nicht) ·
separater Org-Wechsel (läuft über Einsatz-Wechsel) · Personen-/Kräfte-Suche in der Palette
(„später" laut Task) · `?neu`-Handler für Module jenseits der Top 4.

## Architektur

### Docking
Neues Verzeichnis `frontend/src/command-palette/`. Der Provider wird in `main.tsx`
zwischen `AuthProvider` und `App` eingehängt:

```
QueryClientProvider > ThemeModeProvider > AntApp > BrowserRouter > AuthProvider
  > CommandPaletteProvider > App
```

An dieser Stelle hat die Palette Zugriff auf: Router (`useNavigate`/`useLocation`),
`useAuth()`, `useThemeMode()`, den React-Query-Client (`listeEinsaetze`) und den
AntApp-Context (für `Modal`). Damit ist Akzeptanzkriterium 1 („aus jeder Ansicht")
strukturell erfüllt — der Listener lebt oberhalb aller Seiten.

### Komponenten (klein, fokussiert)

| Datei | Verantwortung |
|---|---|
| `typen.ts` | `Befehl`-Typ + `BefehlGruppe`-Enum |
| `CommandPaletteProvider.tsx` | Context (`offen`, `öffne`, `schließe`, `toggle`) + globaler `keydown`-Listener (CMD+K/STRG+K) |
| `useBefehle.ts` | Generiert die kontextabhängige, berechtigungsgefilterte Befehlsliste |
| `fuzzy.ts` | Fuse.js-Wrapper: `filtereBefehle(befehle, suche)` |
| `CommandPalette.tsx` | antd `Modal` mit Suchfeld + gruppierter Liste + Tastatur-Navigation |

### Datentyp

```ts
type BefehlGruppe = 'module' | 'schnellaktionen' | 'einsaetze' | 'einstellungen' | 'navigation';

interface Befehl {
  id: string;              // stabil, z. B. 'modul:etb', 'aktion:person-neu', 'theme:dark'
  gruppe: BefehlGruppe;
  label: string;           // angezeigter Text
  schlagworte?: string[];  // zusätzliche Suchbegriffe (Synonyme, BOS-Fachbegriffe)
  icon?: IconType;         // react-icons (wie modulRegistry)
  ausführen: () => void;   // navigiert oder schaltet — schließt danach die Palette
}
```

Bewusst kein `disabled`-Feld: gesperrte Befehle werden in `useBefehle` gar nicht erst
erzeugt (Akzeptanzkriterium 5 — „keine Aktionen sichtbar").

## Befehlsquellen (in `useBefehle.ts`)

Kontext-Ermittlung: aus `useLocation()` via `matchPath('/einsaetze/:id/*', pfad)` den
aktiven `einsatzId` lesen. Ist keiner aktiv (z. B. `/einsaetze`, `/profil`), entfallen die
einsatz-gebundenen Gruppen.

### 1. Module — *nur im Einsatz-Kontext*
Aus `modulRegistry`, gefiltert: `status === 'fertig'` **und** `istModulSichtbar(m, overrides)`
**und** `!istModulGesperrt(m, benutzer, overrides)`. `ausführen` → `navigate('/einsaetze/' +
einsatzId + '/' + modulZielRoute(m))`. Overrides kommen aus dem bestehenden Einsatz-Kontext
(gleiche Quelle wie `ModulPanel`).

### 2. Schnellaktionen — *nur im Einsatz-Kontext* (Top 4)
Navigiert zur Modul-Route mit `?neu=1`; die Ziel-Seite öffnet ihren bestehenden
Neu-Entry-Point (Pattern analog zum vorhandenen `?person=<id>` in `PersonenPage`).
Rollen-Filter wie bei den Modulen (gleiche `istModulGesperrt`-Prüfung auf das Trägermodul).

| Aktion | Ziel-Route | `?neu=1`-Andockpunkt auf der Ziel-Seite |
|---|---|---|
| Neue Person | `personen` | `setModus('schnell')` (`PersonenPage.tsx:99`) |
| Neuer ETB-Eintrag | `etb` | Fokus auf die angepinnte Erfassungszeile (`EtbPage.tsx:149`) |
| Neue Unfallhilfsstelle | `unfallhilfsstellen` | `setAnlegen(true)` (`UnfallhilfsstellenPage.tsx:35`) |
| Neuer Schaden | `schaeden` | `setErfassenOffen(true)` (`SchaedenPage.tsx:172`) |

**Konvention (wie bei `?person=`):** Die Ziel-Seite liest `?neu=1` per `useSearchParams`,
öffnet/fokussiert den Neu-Eingang und **entfernt den Param danach** (`replace: true`), damit
Schließen + erneutes Navigieren sauber funktioniert. Pro Seite ein kleiner `useEffect`.

### 3. Einsatz-Wechsel — *global*
Aktive Einsätze via `useQuery(['einsaetze'], listeEinsaetze)` (gleicher Query-Key wie
`EinsatzSwitcher`, kein Doppel-Fetch), `status === 'aktiv'`. `ausführen` →
`navigate('/einsaetze/' + e.id)`.

### 4. Schnelleinstellungen — *global*
- **Theme:** drei Befehle (System / Hell / Dunkel) → `useThemeMode().setModus(...)`.
- **Koordinatensystem:** fünf Befehle (WGS84 / DMS / UTM / MGRS / GK) →
  `setzeOverride(format)` aus `koordinatenSystemStore`.

### 5. Navigation — *global*
„Alle Einsätze" (`/einsaetze`), „Profil" (`/profil`), „Abmelden" (`useAuth().logout`).
Admin-only (`benutzer.system_rolle === 'admin'`): „Benutzer" (`/benutzer`), „Stammdaten"
(`/stammdaten`), „Admin" (`/admin`).

## Suche (`fuzzy.ts`)

`fuse.js` über `label` + `schlagworte`, `threshold ≈ 0.4` (Substring sicher, etwas Fuzz).
Leeres Suchfeld → alle Befehle in kuratierter Default-Reihenfolge (Gruppen-Reihenfolge:
Module → Schnellaktionen → Einsätze → Einstellungen → Navigation). Anzeige in der Palette
nach `gruppe` segmentiert mit Gruppen-Überschriften.

## Tastatur & a11y (`CommandPalette.tsx`)

- Beim Öffnen: Autofokus auf das Suchfeld, Auswahl auf den ersten Treffer.
- `↑`/`↓` bewegen die Auswahl (mit Wrap), `Enter` ruft `ausführen` des aktiven Befehls,
  `Esc` schließt ohne Side-Effect (Akzeptanzkriterium 4).
- Sichtbarer Fokus-/Aktiv-Stil auf dem markierten Eintrag; `role="listbox"` + `role="option"`,
  `aria-activedescendant` auf dem aktiven Eintrag, `aria-selected`.
- Liste scrollt den aktiven Eintrag in den Sichtbereich (`scrollIntoView({ block: 'nearest' })`).

## Drawer/Modal-Koexistenz (Akzeptanzkriterium 6)

antd `Modal` mit explizit hohem `zIndex` (über Drawer/Modal-Defaults), `mask` schließt per
Klick. Die Palette **navigiert/schaltet und schließt sich** — sie schließt aber keine
darunterliegenden Drawer/Modals zwangsweise; ein offener Drawer bleibt unverändert, sein
State wird nicht angefasst. Wo die ausgeführte Aktion ohnehin navigiert, räumt der
Routenwechsel den Unterbau regulär ab.

## Tests

### Unit/Komponente (Vitest + React Testing Library) — TDD-getrieben
- `CommandPaletteProvider`: CMD+K und STRG+K öffnen; erneuter Hotkey/ESC schließt.
- `useBefehle`: Modul-/Aktions-Filter — Nicht-Führungskraft sieht rollen-gesperrte Module
  **nicht**; Admin-only-Navigation nur für Admin; ohne Einsatz-Kontext keine Modul-/Aktions-Gruppe.
- `fuzzy`: Substring- **und** Fuzzy-Treffer; leeres Feld → alle.
- `CommandPalette`: `↑`/`↓`/`Enter` navigiert/führt aus; ESC schließt; Theme- und
  Koordinaten-Befehl wirken (Spy auf `setModus` / `setzeOverride`).
- Eine Ziel-Seite (z. B. `PersonenPage` oder `UnfallhilfsstellenPage`): `?neu=1` öffnet den
  Neu-Eingang und der Param wird entfernt.

### e2e (Playwright) — optional, ein Smoke
Palette über offenem Drawer öffnen → Eintrag wählen → korrekt navigiert, Unterbau intakt.
(Layout-/Overlay-Verhalten ist laut Projekt-Erfahrung nur e2e verlässlich prüfbar; Kern-Logik
bleibt Unit.)

## Abhängigkeiten & Einbettung
- Neue Dependency: `fuse.js` (~6 kB gz) im `frontend`-`package.json`.
- Reminder (rust-embed): Nach Frontend-Änderungen `pnpm build` + Backend-Neustart, sonst zeigt
  ein laufendes `cargo run` das alte Bundle. Für reine Unit-Tests irrelevant.

## Wiederverwendete Bausteine
`modulRegistry` (`istModulSichtbar`, `istModulGesperrt`, `modulZielRoute`, `kategorien`) ·
`useAuth()` · `useThemeMode()` · `koordinatenSystemStore` (`setzeOverride`) · `listeEinsaetze` ·
`useSearchParams`-Deeplink-Pattern (`PersonenPage.tsx:122–134`) · react-icons (Tb-Set).

## Risiken / offene Mini-Punkte
- **ETB-Schnellaktion** hat kein Dialog-Toggle, sondern fokussiert die inline-Erfassungszeile —
  braucht eine kleine Fokus-Brücke (Ref/`autoFocus`-Param) statt eines `setOffen(true)`. Falls
  zu fummelig, fällt die ETB-Aktion auf reine Navigation zur ETB-Seite zurück (Erfassungszeile
  ist dort ohnehin sichtbar).
- **Modal-`zIndex` über Drawer**: konkreter Wert beim Umsetzen gegen die antd-Defaults
  verifizieren; per e2e-Smoke absichern.
