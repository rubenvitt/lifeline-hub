# Vertrag „Stammdaten-Abruf“

Stand 25.11.2026 (LLH-1194). Das JSON-Gegenstück zum Vertrag „Stammdaten-Datei“ (LLH-1633). Lifeline
Hub ruft eine Adresse mit dem Adapter **Stammdaten-Abruf** ab (Anbindungen → Adapter) und legt das
Ergebnis einem Admin als Schnappschuss zur Bestätigung vor. Übernommen wird nie ohne Bestätigung.

## Anfrage

```
GET <adresse>
Authorization: Bearer <zugangsschlüssel>
Accept: application/json
```

Nur `https`. Weiterleitungen folgt Lifeline nicht: Eine 3xx-Antwort gilt als Fehler. Das gilt auch für
304, deshalb gibt es kein `ETag`. Ob sich etwas geändert hat, erkennt Lifeline an einem eigenen
Fingerabdruck des Inhalts.

## Antwort

`200 application/json`, ein Objekt mit bis zu drei Listen:

```json
{
  "personal": [
    { "kennung": "h_8Kq2xV1pZ", "name": "Albers, Jana", "qualifikationen": ["Sanitätshelfer", "Sprechfunker"] }
  ],
  "qualifikationen": [ { "kennung": "q-1", "bezeichnung": "Sanitätshelfer" } ],
  "fahrzeuge": [ { "kennung": "fz-1", "funkrufname": "RK Berlin 1/83-1", "opta": "4-83-1", "issi": "1234567" } ]
}
```

Beispiel: `beispiele/stammdaten-abruf.json`.

- **Felder je Eintrag:** wie die Spalten der Stammdaten-Datei.
  - Personal: `name` Pflicht, dazu `kennung`, `herkunft`, `personalnummer`, `telefon`, `traegerorganisation`, `qualifikationen`.
  - Qualifikationen: `bezeichnung` Pflicht, dazu `kennung`, `herkunft`.
  - Fahrzeuge: `funkrufname` Pflicht, dazu `kennung`, `herkunft`, `kennzeichen`, `opta`, `issi`, `typ`, `standort`.
- **Werte:**
  - Text wird getrimmt, leer oder `null` heißt keine Angabe.
  - Zahlen gelten als Text.
  - `qualifikationen` an einer Person ist eine Liste von Texten: Kennungen der Quelle oder Bezeichnungen. Doppelte Einträge werden zusammengefasst, Groß- und Kleinschreibung zählt dabei nicht.
- **`name`:** „Nachname, Vorname“ wird am Komma geteilt.
- **`herkunft`:** Fehlt sie, gilt die Herkunft aus der Einstellung des Adapters.
- **Kennung:** stabil je Datensatz der Quelle, höchstens 100 Zeichen. Ohne Kennung wird ein Eintrag nur über seine Merkmale abgeglichen, gemerkt wird dann nichts.
- **Unbekannte Felder und Listen:** werden nicht gelesen. Die Vorschau nennt nur ihre Namen, nie ihre Werte.
- **Mangelhafter Eintrag** (Pflichtfeld fehlt, Kennung zu lang, falscher Typ): Er erscheint als Fehlerzeile in der Vorschau, die übrigen Einträge gehen normal durch.
- **Ganze Antwort unbrauchbar:** Ist die Antwort kein JSON, kein Objekt, größer als 2 MiB oder enthält sie mehr als 5000 Einträge einer Art, wird kein Schnappschuss angelegt. Der Adapter zeigt dann den Fehler „Antwort unlesbar“ bzw. „Antwort zu groß“.
- **401 oder 403:** Der Adapter zeigt „Zugang abgelehnt“.
