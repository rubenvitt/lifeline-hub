# Proposal

## Why

Im Feld arbeiten nicht nur angemeldete Personen, sondern auch ausgegebene Geräte mit festem
Zweck: Eine Unfallhilfsstelle (UHS) bekommt ein Tablet oder einen Laptop für die
Patientenaufnahme, die Einsatzleitung hängt einen Lagemonitor an die Wand. Heute hängt jede
Sitzung an einem Benutzer, und Rechte gibt es nur je Einsatz und Modul. Ein Gerät müsste also
mit dem Konto einer Person laufen, sähe die volle Stabsoberfläche und den ganzen Einsatz, und
ein verlorenes Tablet ließe sich nur sperren, indem man die Person sperrt. Es fehlen ein
Gerätezugang, eine Bindung an eine einzelne Stelle und eine reine Anzeige ohne Bedienung.

## What Changes

- **Gerätekopplung:** Die Einsatzleitung koppelt ein Gerät an *einen* Einsatz, *eine*
  Funktionsansicht und, wo nötig, *eine* Stelle (UHS). Sie erzeugt dafür einen kurzlebigen
  Kopplungscode (Text und QR), das Gerät löst ihn auf `/koppeln` ein und erhält eine
  Gerätesitzung. Die Kopplung hat eine Ablaufzeit, endet mit dem Einsatz und lässt sich
  jederzeit widerrufen. Ein widerrufenes Gerät verliert **sofort** jeden Zugriff, auch einen
  offenen Live-Kanal.
- **Gerätekonto statt Person:** Jedes gekoppelte Gerät schreibt unter einem eigenen
  Gerätekonto („UHS Nord · Tablet 1“). ETB-Einträge, Sichtungen und Belegungen nennen damit das
  Gerät und die Stelle, nie eine fremde Person. Gerätekonten erscheinen nicht in Benutzer- und
  Mitgliederlisten und können sich nicht mit Passwort, SSO oder Passkey anmelden.
- **Funktionsansichten als Rechteschranke (Server):** Jede Ansicht ist eine feste Liste von
  Lese- und Schreibrechten je Modul plus Stellenbindung. Sie wirkt in den zentralen
  Einsatz-Extractoren, nach dem Grundsatz „alles verboten, was die Ansicht nicht nennt“. Erste
  Ansichten: **UHS-Tablet**, **UHS-Laptop**, **Lagemonitor** (nur lesen, keine
  Personendaten). Weitere Stellen (Betreuungsstelle, Bereitstellungsraum, Einsatzabschnitt,
  Verpflegung) sind als spätere Ansichten vorgesehen, nicht Teil dieser Change.
- **Bedienung für Feldgeräte:** eine eigene, schmale Hülle ohne Modulleiste und ohne
  Sprungpalette, mit fester Startseite der Ansicht, sichtbarem Kopplungs- und
  Verbindungsstatus und touchtauglichen Zielen.
- **Lagemonitor:** Kiosk-Anzeige mit fester Kachelung (Lagekarte, Kopfzahlen, Kräfte,
  UHS-Belegung), Großbild-Lesbarkeit, Bildschirm bleibt an, automatisches Wiederverbinden,
  keine versehentliche Bedienung, Tag- und Nachtdarstellung.
- **`bedien-arbeitsplatz` angepasst:** Die Gerätekopplung wird als vierte Rechtequelle
  zugelassen, und nur für Gerätekonten darf die Ansicht das Startziel festlegen. Für Personen
  bleibt alles, wie es ist.
- **Nicht in dieser Change:** eine Person, die sich an einem gekoppelten Gerät anmeldet und
  dort eine Funktionsansicht wählt (zweite Variante aus dem Ticket). Begründung in `design.md`,
  D2.

Keine **BREAKING**-Änderung für Personen: alle bestehenden Sitzungen, Rollen und Routen
verhalten sich unverändert.

## Capabilities

### New Capabilities

- `geraete-kopplung`: Kopplung, Kopplungscode, Gerätesitzung, Gerätekonto, Ablauf, Widerruf,
  Audit und Zuordnung von Einträgen zu Gerät und Stelle.
- `funktionsansichten`: Katalog der Funktionsansichten, Scope-Matrix (Modul × Lesen/Schreiben ×
  Stelle) und ihre serverseitige Durchsetzung.
- `feldgeraet-bedienung`: Hülle und Bedienregeln eines gekoppelten Feldgeräts (UHS-Tablet,
  UHS-Laptop).
- `lagemonitor`: Kiosk-Anzeige des Lagemonitors.

### Modified Capabilities

- `bedien-arbeitsplatz`: Die Rechteachse kennt zusätzlich die Gerätekopplung; ein Gerätekonto
  darf ein festes Startziel haben.

## Impact

- **Backend:** neue Tabellen `geraet`, `geraet_kopplung`, `geraet_kopplungscode` und eine
  Spalte `session.kopplung_id` (Migrationen nach `0146`); `src/auth/session.rs`
  (`CurrentUser` lehnt Gerätesitzungen außerhalb der freigegebenen Routen ab),
  `src/einsatz/kontext.rs` (Ansicht und Stelle im `EinsatzKontext`, Prüfung in allen
  Gate-Extractoren), neues Modul `src/geraet/`, Live-Kanal (`src/live`, `routes/live.rs`)
  bricht bei Widerruf ab, `src/routes/einsatz_uhs.rs` und `einsatz_person.rs` filtern nach
  Stelle, Benutzer- und Mitgliederlisten blenden Gerätekonten aus. Guard-Test neben
  `tests/einsatz_kontext_guard.rs`.
- **Frontend:** Verwaltung der Kopplungen im Einsatz (Einsatzleitung), Seite `/koppeln`,
  neue Hülle `frontend/src/geraet/` mit den Ansichten UHS-Tablet, UHS-Laptop und
  Lagemonitor; Bereichsdatei `frontend/src/geraet/AGENTS.md` und Eintrag in der Tabelle der
  Wurzel-`AGENTS.md`.
- **Typ-Codegen** für die neuen DTOs und Enums (`scripts/check-typ-codegen.sh`).
- **Desktop-Hülle:** keine Änderung; der Webview lädt `/koppeln` wie jede andere Seite.
- Umsetzung in Subtasks je Baustein (Kopplung und Durchsetzung, UHS-Tablet, UHS-Laptop,
  Lagemonitor), siehe `tasks.md`.
