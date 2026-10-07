## Why

Am Führungsfahrzeug arbeiten Helfer in mehreren Tabs, auf dem Tablet und am Handy mit
zugeklapptem Modulmenü. Fünf Befunde aus dem Audit vom 01.10.2026 machen den Ort unklar:

- **U1 Tab-Titel:** Kein Code setzt `document.title`, jeder Tab heißt „lifeline-hub“. Tabs,
  Verlauf und Lesezeichen sind nicht zu unterscheiden, ein Screenreader nennt keinen Ort
  (WCAG 2.4.2).
- **U5 Ortspfad:** Einsatzdaten nennt sich nicht (h1 ist der Einsatzname, sichtbar bleibt nur
  „Einsätze ›“). Dem ETB fehlt der Einsatzname im Pfad. Meldebild, Lagekarte und
  Einsatz-Einstellungen haben keinen Pfad. Am Handy kürzen alle Pfadteile gleichmäßig
  („Einsätz › …“).
- **U7 Einsatzstatus:** Zwölf Fachseiten hängen den Einsatzstatus unbeschriftet an das h1
  („Tiere Aktiv“). Auf Tiere steht darunter der Filter „Aktiv“, der etwas anderes meint.
- **U29 Wechsler:** Der eigene Einsatz ist nicht markiert, ein Klick darauf wirft aus dem Modul.
  „Stammdaten“ steht für jeden ungesperrt im Menü.
- **U90 Rückweg:** Profil und Verwaltung haben keinen Ortspfad und keinen Weg zurück ins
  zuletzt offene Modul. „Verwaltung“ im Kopf zeigt nicht, dass man dort ist.

Entscheidung 3 der Klärungsrunde (Option A): der Menüname gilt überall, der Tab heißt
„Seite · Einsatz · lifeline-hub“, das Meldebild bleibt die Ausnahme.

## What Changes

- **Tab-Titel aus dem Rahmen:** Der Einsatzrahmen setzt „<Modul> · <Einsatz> · lifeline-hub“ aus
  dem Modulnamen der Route (`modulRegistry`). Ebene 1 setzt „Einsätze“, „Profil“ und
  „<Sektion> · Verwaltung“, die Anmeldung „Anmelden“. Keine Seite setzt den Titel selbst.
- **Ortspfad:** Einsatzdaten trägt das h1 „Einsatzdaten“, der Einsatzname wandert in den Pfad.
  ETB, Einsatzdaten, Meldebild, Lagekarte und Einstellungen führen „Einsätze › <Einsatz> ›“.
  Am Handy bleibt „Einsätze“ ganz, nur der Einsatzname kürzt, sein voller Wortlaut steht im
  `title`.
- **Einsatzstatus:** Das unbeschriftete Status-Etikett fällt aus allen Seitentiteln. Ist der
  Einsatz nicht aktiv, zeigt der Seitenkopf zentral „Einsatzstatus <Etikett>“ neben dem Titel.
  Der Tier-Reiter „Aktiv“ heißt „Offen“, der Wert bleibt `aktiv`.
- **Wechsler:** Der eigene Einsatz ist markiert, ein Klick darauf schließt nur das Menü. Je
  Einsatz eine Nebenzeile mit Einsatznummer und Ort. „Stammdaten“ fällt aus dem Menü.
- **Rückweg:** Der Einsatzrahmen merkt je Person die zuletzt offene Adresse eines Einsatzes. Auf
  Profil und Verwaltung stehen der Ortspfad „Einsätze › Profil“ bzw. „Einsätze › Verwaltung ›“
  und, solange der Einsatz noch aktiv ist, der Knopf „Zurück zu <Einsatz>“. „Verwaltung“ im Kopf
  trägt dort `aria-current="page"` und eine Unterstreichung.

## Capabilities

### New Capabilities

- `seiten-orientierung`: Tab-Titel, Ortspfad, Einsatzstatus im Seitenkopf, Einsatzwechsler und
  Rückweg von Ebene 1.

### Modified Capabilities

Keine.

## Impact

- Frontend: `components/EinsatzSeite.tsx`/`.css`, `components/AdminPage.tsx`,
  `components/AppLayout.tsx`, `einsatz/EinsatzLayout.tsx`, `einsatz/EinsatzSwitcher.tsx`,
  neu `components/useDokumentTitel.ts`, `einsatz/letzterOrt.ts`, `einsatz/EinsatzRahmenKontext.tsx`.
  Seiten: Einsatzdaten, ETB, Meldebild, Lagekarte, Einsatz-Einstellungen, Login und die zwölf
  Seiten mit Status-Etikett. `pages/tiere/tierHelfer.ts`.
- Regel in `frontend/AGENTS.md`, Gestaltungssprache, Eintrag Seitenkopf.
- Kein Backend, keine Migration, keine Typänderung.
- Nicht enthalten: Die Angleichung der Überschriften an die Menünamen („Einsatztagebuch“ →
  „ETB“, „Dashboard“ → „Lagebild“) gehört zu den Modulnamen und folgt im nächsten Ticket. Die
  Hülle gekoppelter Geräte und die Kopplungsseiten behalten „lifeline-hub“.
