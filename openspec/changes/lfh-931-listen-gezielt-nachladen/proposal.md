# Proposal

## Why

Drei Einsatzlisten laden bei jedem Live-Ereignis in jedem offenen Tab ihren ganzen Bestand neu:
das Presse-Log, die Lagebericht- und Befehlsliste (samt aller Abschnittstexte aller
Fortschreibungen) und die Schadenliste (auch bei jedem Foto). Das übertragene Volumen wächst
dadurch quadratisch mit Bestand und Einsatzdauer und trifft vor allem Feldtablets mit schwachem
Netz und den kleinen Server. Seit der zentralen Live-Bündelung (Spec `live-abgleich`) laden
gleichartige Ereignisse nur noch einmal je Fenster nach; dass jedes einzelne Ereignis den
Gesamtbestand kostet, bleibt. ClickUp: LFH-931.

## What Changes

- **Lagebericht-, Befehls- und Pressemitteilungsliste liefern nur Kopfdaten.** Die Listen
  enthalten keine `abschnitte` mehr; den Volltext liefert nur noch das Detail. Die
  Sprungpalette (Vorschau eines Lageberichts) und der Einsatzbericht (Text des letzten
  freigegebenen Lageberichts) laden ihn aus dem Detail. **BREAKING** für die Listenantworten
  der API (nur eigene Clients).
- **Speichern eines Entwurfs lädt keine Liste mehr.** Ändert ein PATCH nur Abschnittstexte,
  kennzeichnet das Live-Ereignis das; andere Tabs laden dann nur das Detail dieses Dokuments.
  Ändern sich Titel oder Zeitstand, lädt die Liste wie bisher.
- **Presse-Log gleicht zeilenweise ab.** Ein neuer Einzelabruf `GET …/stab/medienkontakte/{kid}`.
  Auf ein `presse`-Ereignis mit Medienkontakt-Kennung lädt der Tab nur diese Zeile und sortiert
  sie in seine Liste ein. Ereignisse zu Pressemitteilungen laden nicht mehr das Presse-Log.
- **Schäden:** Lagekarte und Lage-Dashboard lesen eine schlanke Marker-Projektion
  `GET …/schaeden/marker` (Kennung, Registriernummer, Typ, Ausmaß, Status, Lage) statt der
  Volltextliste. Ereignisse zu einem Schaden laden nur diese Zeile in Modulliste und Marker.
  Ablegen und Entfernen von Fotos und Dateien kennzeichnet das Ereignis als Anhang-Änderung und
  lädt nur die Anhangliste dieses Schadens.
- Ereignisse ohne Kennung, `lagged`, ein Neuaufbau ohne Nachlieferung und jeder Fehler beim
  Zeilenabruf fallen auf den bisherigen Abgleich der ganzen Liste zurück.
- **Nicht in diesem Schnitt (Entscheidung offen, siehe design.md):** Blättern der Schadenliste
  und der erledigten Medienkontakte. Beides verändert sichtbares Verhalten und kehrt beim
  Presse-Log die Festlegung aus dem S5-Entwurf um, dass die Medienlage aus der vollständig
  geladenen Liste rechnet.

## Capabilities

### New Capabilities
- `listen-projektion`: Welche Einsatzlisten nur Kopf- bzw. Markerdaten liefern und wo der
  Volltext herkommt (Vorlagendokumente, Schadenmarker).

### Modified Capabilities
- `live-abgleich`: Ereignisse mit Objekt-Kennung gleichen gezielt ab (nur Detail, nur Zeile, nur
  Anhangliste) und fallen sonst auf den Listenabgleich zurück.
- `schaden-anhaenge`: Die Live-Verteilung einer Anhang-Änderung kennzeichnet das Ereignis und
  lädt die Schadenliste nicht neu.
- `stab-presse-log`: Ein Medienkontakt ist einzeln abrufbar; die Live-Aktualisierung lädt nur die
  geänderte Zeile.

## Impact

- Backend: `src/vorlagendokument/` (Kopf-Select, Kopf-DTOs je Art), `src/routes/vorlagendokument.rs`
  (Liste, Payload des PATCH), `src/presse/`, `src/routes/presse.rs` (Einzelabruf),
  `src/schaden/repo.rs`, `src/routes/einsatz_schaden.rs`, `src/routes/schaden_anhang.rs`
  (Marker-Route, Anhang-Kennzeichen), `src/live/mod.rs` (Payload mit Zusatzfeld), `src/api_doc.rs`.
- Typ-Codegen: neue Schemas `LageberichtKopf`, `BefehlKopf`, `PressemitteilungKopf`,
  `SchadenMarker`; beide generierten Dateien.
- Frontend: `live/` (gezielter Abgleich), `api/queryKeys.ts` (Marker-Key, Zuordnung nach
  Payload, `LAGEBILD_OFFLINE`), Listenabnehmer von Lageberichten/Befehlen/Pressemitteilungen,
  `lageberichte/LageberichtVorschau.tsx`, `druck/einsatzbericht/`, Lagekarte
  (`useLagekarteDaten`, Marker, Inspector), Lage-Dashboard (`LAGEBILD_QUELLEN.schaeden`).
- Keine Migration, keine neue Abhängigkeit, keine Layoutänderung.
