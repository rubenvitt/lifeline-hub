# Vertrag „Veranstaltungen-Abruf v1“

Eine neutrale Leseschnittstelle, über die eine andere Anwendung geplante Veranstaltungen
(Sanitätsdienste, Betreuungen, Übungen) an Lifeline Hub gibt. Lifeline ruft sie selbst ab, im Takt
eines Adapters der Art „Veranstaltungen (Schnittstelle v1)“ (Code `veranstaltungen_abruf`). Lifeline
kennt nur diesen Vertrag, keine Anwendung beim Namen; jede, die ihn anbietet, ist anbindbar. Heute
liefert ihn die IUK-Suite (Modul Veranstaltungen).

Design-Doc: [`2026-11-25-w36lkuqp-veranstaltungen-abruf-design.md`](../superpowers/specs/2026-11-25-w36lkuqp-veranstaltungen-abruf-design.md)
(LLH-2097). Code: `src/veranstaltung_extern/` (`vertrag.rs` prüft, `art.rs` ruft ab, `repo.rs`
legt ab).

## Abruf

```
GET <basis_url>/api/abruf
Authorization: Bearer <Schlüssel>
Accept: application/json
```

- `<basis_url>` ist die Einstellung „Adresse der Schnittstelle“ des Adapters (nur `https`, ein
  abschließender `/` zählt nicht). Den Schlüssel stellt die liefernde Anwendung aus (dort ein
  Abruf-Zugang); in Lifeline liegt er verschlüsselt im Geheimnis „Abruf-Schlüssel“ des Adapters.
- Antwort `200`, `application/json`, möglichst mit `Cache-Control: no-store`.
- `401` (oder `403`) bei fehlendem, falschem oder widerrufenem Schlüssel, etwa mit
  `{ "error": { "code": "schluessel_ungueltig" } }`. Den Rumpf einer Fehlantwort liest Lifeline
  nicht.
- Keine Weiterleitung: Lifeline folgt keiner (`3xx` ist ein Fehler).
- Höchstens 512 KiB je Antwort (`art::DECKEL`).

## Antwort

```json
{
  "fassung": 1,
  "stand": "2026-11-25T08:00:00Z",
  "veranstaltungen": [
    {
      "id": "V1StGXR8_Z5jdHi6B-myT",
      "name": "Stadtfest",
      "art": "sanitaetsdienst",
      "status": "zugesagt",
      "ort": "Marktplatz",
      "veranstalter": "Stadtmarketing",
      "beginn": "2026-11-28T07:00:00Z",
      "ende": "2026-11-28T21:00:00Z",
      "bemerkung": "",
      "geaendert": "2026-11-24T19:12:00Z"
    }
  ]
}
```

| Feld | Pflicht | Inhalt |
| --- | --- | --- |
| `fassung` | ja | `1`. Eine andere Fassung lehnt Lifeline mit „Fassung unbekannt“ ab. |
| `stand` | nein | Zeitpunkt der Antwort; Lifeline liest ihn nicht. |
| `veranstaltungen` | ja | höchstens 500 Einträge, jede `id` höchstens einmal |
| `id` | ja | stabile Kennung in der liefernden Anwendung, 1 bis 64 Zeichen |
| `name` | ja | 1 bis 120 Zeichen |
| `art` | ja | `sanitaetsdienst`, `betreuung`, `uebung` oder `sonstiges`; einen anderen Wert nimmt Lifeline als `sonstiges` |
| `status` | ja | `angefragt`, `zugesagt` oder `abgesagt` |
| `ort` | nein | höchstens 120 Zeichen |
| `veranstalter` | nein | eine Stelle, kein Mensch; höchstens 120 Zeichen |
| `bemerkung` | nein | höchstens 2000 Zeichen |
| `beginn`, `ende` | ja | Zeitpunkte, `ende` nach `beginn` |
| `geaendert` | nein | letzte Änderung in der Quelle; Lifeline liest ihn nicht |

- **Fachbegriffe deutsch**, wie es `AGENTS.md` („Bezeichner-Sprache“) für den Wire verlangt.
  Felder, die Lifeline nicht kennt, übergeht es (vorwärtsverträglich).
- **Zeitpunkte** in UTC nach RFC 3339 mit `Z` (`2026-11-28T07:00:00Z`). Lifeline nimmt auch
  einen Versatz (`+01:00`, wird umgerechnet) und das eigene Format `2026-11-28 07:00:00` (UTC) an,
  Jahre 2000 bis 2100, und legt sie sekundengenau als UTC in `zeit::FORMAT` ab.
- **Texte** werden getrimmt; Längen zählen Zeichen, nicht Bytes. Ein fehlender oder `null`-Freitext
  ist leer.
- **Alles oder nichts:** Verstößt ein Eintrag gegen den Vertrag, verwirft Lifeline den ganzen Abruf
  („Antwort ungültig“) und behält den letzten Stand.
- **Fenster:** die Antwort enthält jede Veranstaltung, deren Ende höchstens 7 Tage zurückliegt,
  abgesagte eingeschlossen. So sieht Lifeline eine Absage, bevor die Veranstaltung aus der Liste
  fällt.
- **Personendaten** gehören nicht in die Antwort.

## Was Lifeline daraus macht

- Je Adapter steht jede Veranstaltung einmal in `veranstaltung_extern`, mit ihrem letzten Stand.
  Ein Fingerabdruck (SHA-256 über alle Felder außer `geaendert`) erkennt Änderungen: ein
  unveränderter Abruf schreibt nichts, eine Änderung oder Absage überschreibt die Zeile und setzt
  ihren Änderungszeitpunkt.
- Fehlt eine Veranstaltung in der Antwort, obwohl ihr Ende noch im Fenster liegt (in der liefernden
  Anwendung gelöscht), bekommt sie den Status `entfernt`. Kommt sie wieder, gilt ihr gelieferter
  Status. Was planmäßig aus dem Fenster fällt, bleibt, wie es war.
- Gelöscht wird eine Veranstaltung 14 Tage nach ihrem Ende (Purge-Lauf) oder mit ihrem Adapter.
- Ein Fehlschlag erscheint als Zustand des Adapters, nie als Text der liefernden Anwendung:
  `abgelehnt` (401/403), `antwort_ungueltig`, `version_unbekannt`, `zu_gross` und die Netzfehler
  des Adapter-Rahmens (`src/adapter/zustand.rs`).
- „Verbindung prüfen“ ruft einmal ab, prüft die Antwort und meldet die Zahl der Veranstaltungen,
  ohne etwas abzulegen.
