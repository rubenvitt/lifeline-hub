# LFH-965 Modulnamen: ein Name je Modul, Beschreibung als zweite Zeile

## Warum

Menü, Seitentitel, Ortspfad und Sprungpalette nennen dieselben Module verschieden: „ETB“ heißt auf
der Seite „Einsatztagebuch“, „Dashboard“ heißt „Lagebild 01.10. 23:30“ und im Pfad
„Lage-Dashboard“, „Personen“ heißt „Betroffene“, „Gefahren“ heißt „Gefahrenmatrix“,
„Lagemeldungen“ heißt „Lagerelevante Meldungen“, „Nachforderung“ heißt „Nachforderung
Kräfte/Mittel“. Die gepflegten Modulbeschreibungen sieht niemand: Sie stehen nur auf der
Platzhalterseite, und die erreicht heute kein Modul. Der leere Lagemeldungen-Zustand erklärt in
einem Satz, wo man klickt, statt einen Weg anzubieten. Lagemeldungen und „Meldungen (eingehend)“
tragen dasselbe Symbol.

Entscheidungen (Klärungsrunde Welle 4, alle A): 3 „der Menüname gilt überall“, 4 „Vorgabe“,
7 „Beschreibung als zweite Zeile im Modulmenü und in der Sprungpalette, kein Hilfe-Eintrag“;
LFH-1078 F1 A „Beschreibung aus wenigen Fachwörtern“.

## Was sich ändert

- Das Registry-`label` ist der eine Name: Menü, h1, letzter Pfadeintrag, Sprungpalette, Tab.
  „Dashboard“ → „Lagebild“, „Personen“ → „Betroffene“; die h1 von ETB, Lagebild, Gefahren,
  Lagemeldungen und Nachforderung folgen dem Menü. Die Uhrzeit des Lagebilds wandert in die Meta.
- Seiten holen ihren Namen über `modulName(key)` aus der Registry statt aus einem eigenen String.
- Jede Modulbeschreibung wird auf wenige Fachwörter gekürzt und steht als zweite Zeile im
  Modulmenü (Panel und Drawer) und in der Sprungpalette.
- Der leere Lagemeldungen-Zustand bietet „Zu den Meldungen“ statt des Erklärsatzes.
- Lagemeldungen bekommen ein eigenes Symbol.
- Regel in `frontend/AGENTS.md`, Modulstruktur.

## Nicht Teil davon

- Kein „Hilfe & Begriffe“ im Benutzermenü (Entscheidung 7).
- Keine `EinsatzSeite.beschreibung`-Vorgabe aus der Registry: `frontend/AGENTS.md` (LFH-1078)
  verbietet Zweckabsätze unter Titeln.
- Der Startmodul-Platzhalter ist auf alpha schon richtig („Überblick (Vorgabe)“ aus
  `redirectZiel()`); der Tooltip „Leer = …“ gehört zu LFH-1078 P1 (Einstellungen). Hier kommt nur
  der fehlende Test dazu.
- Schlüssel und Routen bleiben (`personen`, `lage-dashboard`, `gefahrenzonen`/`gefahren`):
  Deeplinks und gespeicherte Einstiegsmodule hängen daran.
