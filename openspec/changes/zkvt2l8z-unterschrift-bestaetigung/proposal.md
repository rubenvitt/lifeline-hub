# Proposal

## Why

Ein kompromittierter Hub kann sich die Gegenzeichnung eines Admins erschleichen (Restrisiko R24 aus
LLH-1490). Er liefert die Seite aus, auf der der Admin unterschreibt, und der Authenticator zeigt
nicht, was er unterschreibt. Ein gekoppelter ELW nähme den untergeschobenen Schlüssel dann an. Die
Notübernahme mit Admin-Unterschrift (LLH-1491) baut auf diesen Schlüsseln auf, darum muss die Lücke
vorher zu sein.

Daneben widersprechen sich zwei Regeln der Spec `org-admin-unterschrift`: Deaktivieren und
Herabstufen MUSS die Schlüssel eines Admins widerrufen, der letzte gültige Schlüssel einer
gekoppelten Org MUST NOT widerrufbar sein. Ruben hat am 08.11.2026 entschieden: Das Deaktivieren
hat Vorrang.

## What Changes

- Ein vom Gegenüber nachgelieferter, gültig gegengezeichneter neuer Unterschriftsschlüssel gilt an
  der übernehmenden Seite erst, wenn ein Admin dort ihn bestätigt. Bis dahin steht er als
  „wartet auf Bestätigung“ und taugt weder zum Unterschreiben noch zum Gegenzeichnen.
- Zum Bestätigen tippt der Admin die letzten vier Zeichen des Fingerabdrucks ein, die ihm der
  Inhaber nennt. Der Dialog zeigt Fingerabdruck, Inhaber, Unterzeichner und Zeitpunkt der
  Erklärung. Ein Admin kann den Schlüssel auch ablehnen; abgelehnt lebt er nie wieder auf.
- Der Grundstock beim Koppeln und Widerrufe brauchen keine Bestätigung.
- Deaktivieren und Herabstufen eines Admins gelingen auch dann, wenn er den letzten gültigen
  Schlüssel einer gekoppelten Org hält. Die Benutzerverwaltung warnt vorher, die Kopplung zeigt
  danach den Ausweg (Kopplung widerrufen, Schlüssel registrieren, neu koppeln).
- Neue Aktionen in der Admin-Spur: Schlüssel bestätigt, Schlüssel abgelehnt.
- R24 bleibt in der Architekturdoku offen, aber verengt: Der Abgleich fängt jeden Schlüssel, den niemand angekündigt hat, nicht aber einen, der eine echte Registrierung im selben Zeitfenster überdeckt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `org-admin-unterschrift`: Neue Schlüssel vom Gegenüber brauchen eine Bestätigung an der
  übernehmenden Seite. Der Schutz „letzter Schlüssel“ weicht dem Deaktivieren und Herabstufen.
  Die Admin-Spur kennt Bestätigen und Ablehnen.

## Impact

- **Datenbank:** eine neue Migration. Sie baut `unterschrift_schluessel` mit den Zuständen
  `wartet_auf_bestaetigung` und `abgelehnt` und den Spalten `entschieden_at` und
  `entschieden_von` neu auf, ebenso `admin_audit` mit zwei neuen Aktionen.
- **Backend:** `src/auth/unterschrift/` (Übernahme, Bestätigen, Ablehnen),
  `src/routes/instanz.rs` (zwei Routen, Übersicht), `src/routes/benutzer.rs` (Anzeige „hält den
  letzten Schlüssel“), `src/auth/admin_audit.rs`.
- **API:** `POST /api/admin/instanz/unterschrift/{id}/bestaetigen` und
  `/ablehnen`. Ein neues Feld an der Benutzeranzeige, neue Enum-Werte, generierte Typen.
- **Frontend:** `frontend/src/instanz/` (Bestätigungsdialog, Hinweise),
  `frontend/src/pages/BenutzerPage.tsx` (Warnung), Zugangsprotokoll-Texte.
- **Doku:** Anwenderkapitel Instanzkopplung, Architektur Kapitel 8 und 11.
- **Protokoll:** keine Änderung. Die Bestätigung bleibt an der übernehmenden Seite, das Gegenüber
  erfährt nichts davon.
