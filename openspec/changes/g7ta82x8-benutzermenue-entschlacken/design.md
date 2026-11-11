# Design

## Context

Siehe proposal.md, „Why“. Stand im Code:

- `components/BenutzerMenu.tsx` baut ein antd-`Dropdown` mit `menu.items`. Darstellung,
  Bediendichte und Helligkeit sind drei `type: 'group'`-Gruppen mit je einem `menuitem` pro Wert;
  der Zustand steht als „✓“ im Text (`umschaltEintrag`). Der Kopf ist schon heute eine Gruppe mit
  eigenem `label`-Inhalt.
- `components/instrument/Segmentleiste.tsx` ist der Umschalter der Gestaltungssprache:
  `radiogroup`, roving tabindex, Pfeile/Pos1/Ende, `gesperrt` mit Grund (`aria-describedby`),
  Staffel 30/48/72 als Mindesthöhe, Fugenraster mit Zielabstand. Die Leiste ist
  `inline-flex` und richtet sich nach ihren Wörtern, nicht nach der Breite des Behälters.
- `hilfe/HilfePage.tsx` ist ohne Anmeldung und ohne Netz erreichbar und kennt die Sitzung
  (`useAuth`: `benutzer`, `geraet`). Die Übersicht (ohne Kapitel in der Adresse) geht nicht in den
  Druck.
- `rueckmeldung/adresse.ts` baut die Formularadresse aus Version, Oberfläche und dem
  Routenmuster eines Pfads; das Menü gab bisher `location.pathname` der aktuellen Seite mit.
- `alarm/EingaengeKnopf.tsx` öffnet die Eingänge als Klappfläche (ab `md`) oder als Blatt von
  unten (gebündelter Kopf).
- Mockups (abgestimmt, Variante A): https://claude.ai/artifact/1Qv9ekT2kPm3CjK8Pk67vK.

## Goals / Non-Goals

**Goals:**

- Ein Menü, das am Handy in `komfortabel` ganz ins Fenster passt und in dem die Helligkeit
  weiter mit einem Tipp gesetzt wird.
- Kein Weg geht verloren: Rückmeldung und Lizenzen auf der Hilfe, Benachrichtigungen zusätzlich
  aus den Eingängen.

**Non-Goals:**

- Das Gerätemenü gekoppelter Geräte (`geraet/GeraeteMenue.tsx`) bleibt, wie es ist.
- Die Sprungpalette ändert ihre Befehle nicht.
- Kein neues Seitenlayout der Hilfe; nur ein Abschnitt in der Übersicht.
- Gespeicherte Schlüssel für Darstellung, Dichte und Helligkeit bleiben.

## Decisions

### D1 Variante A: Segmentleisten im Menü

Je Achse eine `Segmentleiste` unter der Überschrift „Anzeige“, mit sichtbarem Etikett über der
Leiste („Darstellung“, „Bediendichte“, „Helligkeit in %“).

- *Verworfen B, Untermenü „Anzeige ›“:* das kürzeste Hauptmenü, aber zwei Tipps für die
  Helligkeit, und antd klappt Untermenüs seitlich auf, was am Handy (390 px) aus dem Fenster
  läuft.
- *Verworfen C, eigene Seite im Profil:* nachts müsste man für die Helligkeit ETB oder Lagekarte
  verlassen; schnell bliebe nur die Sprungpalette, die keinen aktiven Wert zeigt.

### D2 Einbau als Gruppen-Inhalt, nicht als eigenes Popup

Die Gruppe „Anzeige“ ist ein `type: 'group'`-Eintrag, dessen `label` die drei Leisten rendert
(wie der Kopf). Ein Klick auf den Gruppeninhalt löst kein `onClick` des Menüs aus; das Menü
bleibt offen und zeigt die neue Wahl.

Die Leisten fangen ihre Tasten selbst ab: ←/→/↑/↓, Pos1, Ende, Leertaste und Enter gehen nicht
an `rc-menu` weiter (`stopPropagation` am Behälter), sonst wanderte der Menüfokus mit oder das
Menü schlösse. Tab erreicht das gewählte Segment jeder Leiste (roving tabindex der Leiste).

- *Verworfen `popupRender` mit selbst gebautem Popup:* zwei Menüs um die Leisten herum brächen
  die Pfeilnavigation zwischen Profil, Abmelden und den Einträgen darunter, und die
  Schließlogik von antd müsste nachgebaut werden.

### D3 Segmentleiste in voller Breite

`Segmentleiste` bekommt eine optionale Eigenschaft für volle Breite: die Leiste wird `flex`, jede
Zelle wächst gleich (`flex: 1`), das Wort bleibt mittig. Ohne die Eigenschaft bleibt alles wie
bisher. Das Menü ist dafür am Desktop 320 px breit, am Handy nimmt es die Breite des Fensters
abzüglich 16 px.

- *Verworfen: Breite über `style` von außen:* trifft nur die Leiste, nicht die Zellen.

### D4 Helligkeitssperre an der Leiste

Mit aktiver Warnung lautet das Etikett „Helligkeit in % · mind. N % (Warnung aktiv)“; die Stufen
unter dem Boden sind `gesperrt` mit dem Grund „Warnung aktiv: mindestens N %“. Liegt die Wahl
unter dem Boden, bleibt sie in der Leiste ausgewählt, und eine Zeile unter der Leiste nennt
„Gewählt W %, wirkt N %“. Ob die Leiste ein zugleich gewähltes und gesperrtes Segment trägt
(Fokus, Tab-Reihenfolge), sichert ein Test; trägt sie es nicht, wird das in `Segmentleiste`
ergänzt.

### D5 Bereich der App beim Rückmelden aus der Hilfe

Der Eintrag „Hilfe“ im Menü öffnet die Hilfe mit `state: { von: <aktueller Pfad> }` (die
Sprungpalette hat keinen Hilfe-Befehl). Die Hilfe
gibt `von` (sonst den eigenen Pfad) an `rueckmeldungsAdresse`, das wie bisher nur das Routenmuster
weitergibt. So steht im Formular weiter der Bereich, aus dem die Person kam.

- *Verworfen: Bereich weglassen:* nähme der Entwicklung die wichtigste Angabe.
- *Verworfen: letzter Pfad im `sessionStorage`:* veraltet, sobald jemand die Hilfe direkt öffnet.

### D6 Rückmeldung und Lizenzen in der Übersicht der Hilfe

Unter den Bereichskarten, vor „Alle Kapitel am Stück“, steht ein Abschnitt mit „Fehler gefunden
oder eine Idee?“, einem Satz zu den mitgegebenen Feldern und dem Knopf „Rückmeldung geben ↗“;
darunter Version und der Link „Lizenzen ↗“. Der Abschnitt geht nicht in den Druck. In der
Sitzung eines gekoppelten Geräts fehlt der Rückmeldeknopf (Entscheidung aus LLH-1549), der Link
„Lizenzen“ bleibt. Ohne Anmeldung (Hilfe von der Anmeldeseite) stehen beide da: das Formular ist
öffentlich, und Anmeldeprobleme sind ein häufiger Anlass.

- *Verworfen: im Seitenkopf der Hilfe:* der Kopf trägt Drucken und den Rückweg; unter `md`
  müssten Nebenwege nach `einsatztauglichkeit-layout` hinter „Weitere“, und die Rückmeldung
  verschwände wieder.

### D7 Link in den Eingängen

Am Fuß der Klappfläche und des Blatts „Eingänge“ steht „Benachrichtigungen einstellen →“; er
schließt die Fläche und führt auf `BENACHRICHTIGUNGEN_PFAD`.

### D8 Wo die Regeln stehen

Neue Fähigkeit `benutzermenue` für Aufbau, Leisten, Platz am Handy und die ausgelagerten Wege.
`bedien-helligkeit` ändert nur die beiden Szenarien, die „✓ im Text“ und „Gruppe“ nennen.
`bedien-dichte` („Umschaltgruppe ‚Bediendichte‘ im Benutzermenü“) und
`einsatztauglichkeit-layout` („Profil und Abmelden vor den Umschaltgruppen“) gelten wörtlich
weiter und bleiben unverändert.

### D9 Tests sprechen die Leisten über Rollen an

Unit- und e2e-Tests wählen künftig `getByRole('radiogroup', { name: 'Darstellung' })` →
`getByRole('radio', { name: 'Hell' })` und prüfen `aria-checked`. Für e2e kommt ein Helfer in
`e2e/menue-kern.ts` („Anzeige im Benutzermenü wählen“), den alle Specs nutzen, die heute
`menuitem` „Handschuh“, „Dunkel“, „60 %“ usw. anklicken.

### D10 Entwurf im Repo

Die Zeichenflächen kommen als `.dc.html` mit `canvas.json` nach
`docs/design/2026-11-11-benutzermenue/` (Inline-Styles maßgeblich, `frontend/AGENTS.md`).
Da `Segmentleiste` ein vorgestellter Baustein des Design Systems ist, läuft
`pnpm -C frontend design-system`, und das Erzeugte kommt in den PR; nach dem Merge wird das
Design System neu veröffentlicht.

## Risks / Trade-offs

- [rc-menu fängt Tasten oder Klicks im Gruppeninhalt ab, das Menü schließt beim Wählen] →
  `stopPropagation` am Behälter der Leisten, Unit-Test „Menü bleibt nach Wahl offen“ und e2e mit
  Tastatur.
- [Im Handschuh-Betrieb ragt „Hilfe“ am Handy knapp unter den Rand] → Spec verlangt nur Kopf bis
  „Anzeige“ ohne Rollen; das Menü rollt in sich (`max-height`, wie heute).
- [Tests und Bildlauf in vielen Dateien sprechen `menuitem`-Namen an] → ein gemeinsamer e2e-Helfer;
  `grep` nach den alten Namen als Abschlussprüfung.
- [Die Hilfe ohne `von` meldet `/hilfe` als Bereich] → nur bei direktem Aufruf oder über einen
  Link im Kapiteltext; das Menü gibt `von` mit.

## Migration Plan

Reine Oberflächenänderung, keine Daten. Rücknahme durch Revert des PRs.
