# Versand-Anbindung ohne Abruf-Angaben (LLH-2126) — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/x256kbnt8fqxc3jh3k4lf385 · Größe: kleine Änderung
(kurzes Design-Doc) · Route `entwurf` (E1, E3).

## Absicht

Die Seite einer Versand-Anbindung (SMTP, Matrix, Fax über sipgate) zeigt heute die Sprache der
Abruf-Adapter: „noch nie abgerufen“, „Nächster Versuch“, „Intervall 3600 s“, „n Einträge“,
„Letzte Versuche · Noch kein Abruf.“. Der Admin liest daraus, die Anbindung arbeite nicht. Eine
Versand-Anbindung ruft nichts ab. Der Lauf prüft in ihrem Takt nur die Verbindung
(`smtp_art.rs`, `matrix_art.rs`, `sipgate_fax_art.rs`: „prüft nur die Verbindung, sendet nichts und
übernimmt nichts“). Die Seite soll das so sagen.

## Ziele, Nicht-Ziele

- **Ziel:** Eine Versand-Anbindung spricht von **Prüfung**, zeigt kein Intervall und keine
  Eintragszahl. Anlegen und bearbeiten verlangen kein Intervall.
- **Ziel:** Abruf-Anbindungen sehen unverändert aus.
- **Nicht-Ziel:** die regelmäßige Prüfung abschalten (sie meldet ein abgelaufenes Passwort, bevor
  eine eilige Nachricht daran scheitert).
- **Nicht-Ziel:** „letzte Übergabe aus dem Ausgang“ an der Anbindung. Das braucht eine neue
  Abfrage im Ausgang und wird eine eigene Nachzug-Aufgabe.
- **Anti-Ziel:** ein Merkmal, das das Frontend aus dem Art-Code errät (Liste `smtp`/`matrix`/
  `sipgate_fax` im Client): die Art sagt es selbst.

## Ansätze

1. **Prüfung behalten, fester Takt, Anzeige als Prüfung (gewählt).** Die Art meldet ihren
   Zweck, der Server legt das Intervall auf den Vorschlag der Art fest, das Frontend blendet
   das Intervall aus und benennt Zustand und Verlauf um.
2. **Prüfung abschalten** (Wortlaut des Auftrags): der Scheduler lässt Versand-Arten aus, nur
   „Verbindung prüfen“ von Hand. Verworfen: ein Fehler fiele erst beim Senden auf, und die
   drei Design-Docs des Ausgangs (LLH-2093/2094/2095) wollen die Prüfung.
3. **Prüfung behalten, Feld „Prüfintervall“ bearbeitbar.** Verworfen: eine Einstellung, die
   niemand braucht; der Takt der Art genügt.

Gewählt vom Menschen am 27.11.2026 (Punkte 1a, 2a, 3, 4a).

## Entscheidungen

### Backend

- `AdapterArt` bekommt `fn zweck(&self) -> AdapterZweck` mit Vorgabe `Abruf`;
  `AdapterZweck` ist ein `wire_enum!` mit `abruf` und `versand`. `SmtpArt`, `MatrixArt`,
  `SipgateFaxArt` liefern `Versand`.
- `AdapterArtAnzeige` bekommt das Feld `zweck` (bestehender Typ mit deutschen Feldern, also
  deutsch; `AGENTS.md`, Bezeichner-Sprache). Typ-Codegen und beide generierten Dateien mit.
- Anlegen (`POST`) und Ändern (`PATCH`): bei einer Versand-Art gilt das Intervall der Art
  (`intervall_vorschlag_s`). Ein gesendetes `intervall_s`, das davon abweicht, ist 400
  („intervall_s: bei einer Versand-Anbindung fest“). Fehlt es, bleibt der Wert, wie er ist
  (beim Anlegen der Vorschlag). Bestehende Zeilen mit anderem Wert bleiben unberührt.
- Scheduler und Lauf ändern sich nicht. Ein Test hält fest, dass ein Lauf einer Versand-Art
  nichts übernimmt und die Eintragszahl 0 bleibt (heute schon so, `OhneUebernahme(0)`).

### Frontend (`frontend/src/pages/einstellungen/`)

Für eine Art mit `zweck === 'versand'`:

| Stelle | bisher | neu |
| --- | --- | --- |
| Zustand `wartet` (Ansicht und Liste) | „noch nie abgerufen“ | „noch nicht geprüft“ |
| Liste, Nebenangabe | „zuletzt erfolgreich …“ | „zuletzt geprüft …“ |
| Ansicht, Datenfeld | „Zuletzt erfolgreich · n Einträge“ | „Zuletzt geprüft“, ohne Anzahl |
| Ansicht, Datenfeld | „Nächster Versuch“ | „Nächste Prüfung“ |
| Ansicht, bearbeitbare Felder | Zeile „Intervall“ | entfällt |
| Anlegen | Feld „Intervall“ (Pflicht) | entfällt, nichts gesendet |
| Verlauf, Titel / leer | „Letzte Versuche“ / „Noch kein Abruf.“ | „Letzte Prüfungen“ / „Noch keine Prüfung.“ |
| Verlauf, Eintrag | „abgerufen · n Einträge“ | „erreichbar“, ohne Anzahl |
| Ergebnis „Verbindung prüfen“ | „… · nichts übernommen“ | ohne den Zusatz |

Abruf-Arten: alles wie bisher; Tests halten das fest.

## Dem Bauenden überlassen

Schnitt der Hilfsfunktionen (etwa `isVersandArt(art)` in `adapterAnzeige.ts`), Form der Tests,
und ob `adapterVersuchText` einen Parameter bekommt oder die Ansicht den Text selbst bildet.
