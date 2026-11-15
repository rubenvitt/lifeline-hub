# Design

## Context

Aufgabe LLH-1730 (UI/UX-Analyse vom 12.11.2026, Thema 1). Lösungsweg mit Ruben am 15.11.2026
abgestimmt: Abmelden ans Menüende mit Rückfrage, dieselbe Rückfrage in der Sprungpalette, die
drei Anzeige-Leisten zusätzlich im Reiter „Anzeige“ der Einsatz-Einstellungen und im Profil. Der
Kopf bleibt unberührt, weil LLH-1726 ihn parallel entlastet.

Stand im Code:

- `components/BenutzerMenu.tsx` baut ein antd-`Dropdown`. Reihenfolge: Kopf, Trenner, „Profil“,
  „Abmelden“ (`danger`), Trenner, Gruppe „Anzeige“ (`AnzeigeLeisten` als Gruppentitel), Trenner,
  „Benachrichtigungen“, „Neuigkeiten“, „Hilfe“. Im Handschuh-Betrieb stehen Profil und Abmelden
  als zwei halbe Zeilen nebeneinander (D11 aus `g7ta82x8-benutzermenue-entschlacken`). Ein Klick
  auf „Abmelden“ ruft sofort `logout()` und navigiert zu `/login`; `false` (412, LFH-387) lässt
  den Tab stehen.
- `geraet/GeraeteMenue.tsx` fragt beim „Gerät abmelden …“ schon über ein `Modal` zurück
  („Gerät abmelden?“, roter Knopf „Abmelden“, „Abbrechen“).
- Die Sprungpalette führt „Abmelden“ als `nav:abmelden` (`nichtMerkbar`), `useBefehle` reicht
  `logout()` ohne Navigation durch; den Weg zur Anmeldung übernimmt dort der Rahmen.
- `components/AnzeigeLeisten.tsx` trägt Überschrift „Anzeige“, die drei Segmentleisten in voller
  Breite und fängt Tasten für das Menü ab (`stopPropagation`). Außerhalb des Menüs schadet das
  nicht: die Leisten bedienen dieselben Tasten selbst.
- `pages/EinsatzEinstellungenPage.tsx` rendert die Sektionen aus `EINSTELLUNGEN_SEKTIONEN`
  (`routing/deeplinks.ts`) als Reiter, die Routen stehen in `App.tsx` (`EINSTELLUNGEN_ROUTEN`).
  Im abgeschlossenen Einsatz zeigt die Seite außer bei „Aufbewahrung“ einen Rechtehinweis. Das
  Modul `einsatz-einstellungen` ist für jedes Mitglied sichtbar (Spec `modul-freigabe`).
- `pages/ProfilPage.tsx` hat ein Paneel „Darstellung auf diesem Gerät“ mit der Zeitdarstellung
  am Gerät.

## Goals / Non-Goals

**Goals:**

- Ein Fehlgriff auf „Abmelden“ beendet keine Sitzung mehr, egal ob aus Menü oder Palette.
- Abmelden steht da, wo man es erwartet: am Ende des Menüs, abgesetzt von Profil.
- Darstellung, Dichte und Helligkeit sind dort zu finden, wo man Einstellungen sucht.

**Non-Goals:**

- Kopfleiste und Initialen-Auslöser bleiben, wie sie sind (LLH-1726, LLH-1728).
- Das Gerätemenü gekoppelter Geräte (`geraet/GeraeteMenue.tsx`) bleibt unverändert.
- Keine Rückfrage beim Abmelden durch Sitzungsablauf, 401 oder „Sitzungen beenden“: das sind
  keine Bedienhandlungen dieses Tabs.
- Die Zeitdarstellung am Gerät wandert nicht in den neuen Reiter; sie bleibt im Profil.
- Gespeicherte Schlüssel für Darstellung, Dichte und Helligkeit bleiben.

## Decisions

### D1 Abmelden als letzter Eintrag, durch Trenner abgesetzt

Reihenfolge: Kopf, Trenner, „Profil“, Trenner, „Anzeige“, Trenner, „Benachrichtigungen“,
„Neuigkeiten“, „Hilfe“, Trenner, „Abmelden“ (rot). Profil steht im Handschuh-Betrieb wieder in
voller Breite; die halbe Zeile aus D11 entfällt. Weil Profil weiter eine Zeile belegt, bleibt die
Höhe bis zur Gruppe „Anzeige“ gleich, und die Helligkeit liegt am Handy im Handschuh-Betrieb
weiter im Fenster.

- *Verworfen: Abmelden oben lassen, nur Rückfrage:* hätte zwei Specs fast unverändert gelassen,
  weicht aber vom Auftrag ab; am Menüende ist der Eintrag dort, wo man ihn sucht.
- *Verworfen: am Ende, im Handschuh-Betrieb oben:* zwei Reihenfolgen zu pflegen und zu testen.

Folge: Im Handschuh-Betrieb am Handy rollt man im Menü bis „Abmelden“. Ruben hat das am
15.11.2026 so gewählt; die Rückfrage verhindert den teuren Fehlgriff, nicht die Lage.

### D2 Eine Rückfrage, zweimal eingehängt

Eine Komponente mit Hook (`auth/AbmeldenRueckfrage.tsx`, Name beim Umsetzen nach
`AGENTS.md`, „Bezeichner-Sprache“): `useAbmeldenRueckfrage()` liefert `fragAbmelden()` und das
Dialog-Element. Der Dialog ist ein antd-`Modal`, kein `Popconfirm`: das Dropdown schließt beim
Klick, und die Palette hat keinen Anker. Titel „Abmelden?“, Text „Die Sitzung auf diesem Gerät
endet.“, Knöpfe „Abbrechen“ und rot „Abmelden“ (`okButtonProps.danger`, Ladezustand während
`logout()`). Bestätigt: `logout()`, bei `true` `navigate('/login', { replace: true })`, bei
`false` (412) bleibt der Tab stehen wie bisher.

Eingehängt wird der Dialog zweimal: im `BenutzerMenu` und im stets eingehängten
`CommandPaletteProvider`, der `fragAbmelden` an `useBefehle` weiterreicht (statt `logout`). Kein
neuer App-weiter Provider: die Test-Wrapper bleiben unverändert, und die beiden Einhängepunkte
sind die einzigen Bedienwege zum Abmelden des Stabs.

- *Verworfen: ein App-weiter Provider:* müsste innerhalb des Routers sitzen (Navigation) und in
  jeden Test-Wrapper; zwei Instanzen sind billiger.
- *Verworfen: `modal.confirm` aus `App.useApp()`:* der Ladezustand und der 412-Fall ließen sich
  schlechter testen, und `frontend/AGENTS.md` bevorzugt benannte Dialoge.

### D3 Der Fokus steht in der Rückfrage auf „Abbrechen“

Aus der Palette kommt die Rückfrage per ↵. Stünde der Fokus auf „Abmelden“, beendete ein
zweites ↵ (oder ein Tastenwiederholer) die Sitzung doch. Deshalb erhält „Abbrechen“ den
Anfangsfokus; Escape schließt wie „Abbrechen“.

### D4 Reiter „Anzeige“ in den Einsatz-Einstellungen

Neue Sektion `anzeige` mit Label „Anzeige“, als letzter Eintrag in `EINSTELLUNGEN_SEKTIONEN`
(die erste Sektion bleibt Redirect-Ziel, „Zugriff“ bleibt hinter „Geräte“). Inhalt: ein Paneel
„Anzeige auf diesem Gerät“ mit dem Satz „Gilt nur auf diesem Gerät, nicht für den Einsatz.“ und
den drei Leisten. Kein Formular, kein Speichern-Knopf, keine Rechte: die Wahl ist eine
Geräteeinstellung. Der Rechtehinweis des abgeschlossenen Einsatzes entfällt für diese Sektion wie
für „Aufbewahrung“.

- *Verworfen: Knopf im Kopf:* kollidiert mit LLH-1726, das den Kopf entlastet.
- *Verworfen: nur Profil:* der Weg dorthin führt wieder über die Initialen.

### D5 Dieselben Leisten an allen Orten

`AnzeigeLeisten` wird ohne Menübezug nutzbar: eine Eigenschaft blendet die Überschrift „Anzeige“
aus, wenn der umgebende Paneeltitel sie schon trägt (die Gruppe behält ihren zugänglichen Namen).
Auf Seiten begrenzt eine Höchstbreite die Leisten, damit fünf Helligkeitsstufen im
Handschuh-Betrieb (440 px, D12 aus `g7ta82x8`) passen, ohne am Desktop über die ganze Seite zu
laufen. Da alle drei Orte dieselben Hooks lesen (`useThemeMode`, `useDichte`, `useHelligkeit`),
zeigen sie ohne weiteres denselben Wert.

### D6 Profil

Das Paneel „Darstellung auf diesem Gerät“ trägt zuerst die drei Leisten, darunter wie bisher die
Zeitdarstellung. Die Seite liegt außerhalb eines Einsatzes und schließt die Lücke für alle, die
gerade in keinem Einsatz sind.

## Risks / Trade-offs

- [In `komfortabel` am Handy ragt „Abmelden“ unter den Rand, weil ein Trenner dazukommt] → e2e
  misst das Szenario „Komfortabel am Handy“; reicht der Platz nicht, entfällt der Trenner vor
  „Profil“ statt eines Eintrags.
- [e2e-Specs und Bildlauf klicken „Abmelden“ und erwarten sofort `/login`] → ein gemeinsamer
  Helfer in `e2e/menue-kern.ts` („abmelden über das Benutzermenü“) bestätigt die Rückfrage; `grep`
  nach `'Abmelden'` als Abschlussprüfung.
- [Die Palette schließt und öffnet im selben Takt einen Dialog; der Fokus springt zurück ins
  Suchfeld] → Test „Rückfrage aus der Palette hat den Fokus auf Abbrechen“.
- [Paralleler Umbau von Kopf und Rahmen (LLH-1726, LLH-1728)] → hier keine Änderung an
  `Kopfleiste.tsx` und `EinsatzLayout.tsx`; Konflikte höchstens in `BenutzerMenu.tsx`.

## Migration Plan

Reine Oberflächenänderung, keine Daten. Rücknahme durch Revert des PRs.
