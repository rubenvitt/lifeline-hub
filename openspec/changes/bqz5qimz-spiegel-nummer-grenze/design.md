# Design

## Context

Die Kopfzeile eines Spiegels läuft durch `abbilden` wie jede gespiegelte Zeile; `kopf_uebernehmen`
nimmt danach nur `id` und `kennung` heraus, `schema::LOKALE_SPALTEN` kennt nur `spiegel`. Die
Spalten `nummer_jahr` und `nummer_lfd` haben keinen CHECK (Migration 0115). Zwei Stellen rechnen aus
ihnen `MAX + 1`:

- `einsatz::repo::anlegen_tx` über die **eigenen** Einsätze des Jahres und das Löschprotokoll,
- `instanz::spiegel::nummer::ensure_freie_nummer` über **alle** Einsätze des Jahres, Spiegel
  eingeschlossen, und das Löschprotokoll (Spec `einsatznummer`, „Neue Nummer über den Spiegeln“).

Hinweise einer Übernahme stehen in `Ergebnis::hinweise`; `abgleich::save_hinweis` schreibt sie an
`einsatz_spiegel.hinweis`, die Oberfläche zeigt sie am Spiegel.

## Goals / Non-Goals

**Goals:**
- Kein Wert einer Gegenstelle kann die Nummernvergabe dieser Instanz zum Absturz oder Umlauf bringen.
- Ein Spiegel mit unplausiblen Zahlen bleibt sonst voll nutzbar.

**Non-Goals:**
- Den Nummerntext (`einsatznummer_intern`) prüfen: Er geht in keine Rechnung ein, seine
  Eindeutigkeit sichern Index und `ensure_freie_nummer` schon.
- Bestand bereinigen: Kein Fall bekannt; das Netz aus D3 trägt ihn.
- Weitere Kopffelder auf Plausibilität prüfen.

## Decisions

### D1 Eine Gegenstelle ist für die Zahlen ihres Kopfs nicht vertrauenswürdig

Die Kopplung sichert, **wer** liefert (Signatur), nicht, dass der Inhalt stimmt. Die Zahlen fließen
hier in eine Rechnung, die alle eigenen Vorgänge des Jahres trägt; ein Fehler der Gegenstelle darf
sie nicht vergiften. Deshalb Prüfung an der Grenze, in `kopf_uebernehmen` nach `abbilden`, für
Anlage und Aktualisierung des Spiegels gleich.

### D2 Außerhalb der Grenze: beide Zahlen leer, Text bleibt, Hinweis (abgestimmt 14.11.2026)

Gültig ist das Paar nur, wenn beide Werte ganze Zahlen sind, Jahr 2000–9999 (vierstellig wie im
Format), laufende Nummer 1–999.999. Bei 999.999 kann `+ 1` nie überlaufen, und keine Organisation
erreicht die Grenze. Sonst werden **beide** geleert, damit nie ein halbes Paar entsteht; ein leeres
Paar verhält sich wie Altbestand ohne Nummer (Spec `einsatznummer`, „Bestand“) und zählt in keiner
Vergabe. Ein leeres Paar ohne Text ist gültig und bekommt keinen Hinweis.

Hinweistext: „Einsatznummer der Gegenstelle außerhalb der Grenzen (Jahr …, laufende Nummer …);
Jahr und laufende Nummer nicht übernommen.“ Dazu `tracing::warn!` wie bei jedem Übernahmehinweis.

Verworfen:
- **Ganze Lieferung ablehnen:** Der Spiegel bliebe auf altem Stand, bis die Gegenstelle ihren Kopf
  ändert; ein Nummernfeld legte das Lagebild still.
- **Nur `checked_add`, Kopf vertrauen:** Kein Absturz mehr, aber weil `ensure_freie_nummer` über
  alle Spiegel zählt, scheiterte jeder Führungswechsel und jede Verwahrung des Jahres mit belegter
  Nummer dauerhaft, und eine Übergabe im Abgleich bräche in jedem Takt ab.
- **Engeres Jahr (heute ± 1):** Spiegel alter Einsätze, die nach langer Trennung nachgeholt werden,
  verlören ihre Zahlen ohne Grund.

### D3 Geprüfte Addition als Netz, 422

`anlegen_tx` und `ensure_freie_nummer` rechnen `max.checked_add(1)` und in ihren Ausweichschleifen
`lfd.checked_add(1)`. Bei `None` `AppError::UnprocessableEntity` mit „Der Nummernkreis des Jahres
ist erschöpft.“ — 422, weil der Zustand die Anfrage verhindert (`src/AGENTS.md`,
Statuscode-Konvention), nicht das Feld. Die Grenzen aus D2 machen den Fall für neue Übernahmen
unmöglich; das Netz gilt für Bestand und für jeden künftigen Weg, der die Spalten schreibt.

Verworfen: Werte über der Grenze im `MAX` ignorieren. Das hielte die Vergabe auch bei Bestand
offen, verteilte die Grenze aber auf drei SQL-Abfragen und verdeckte kaputte Daten still.

### D4 Grenzen an einer Stelle

`einsatz::nummer` bekommt die Konstanten (`JAHR_GRENZEN`, `LFD_GRENZEN`) und eine reine Funktion,
die ein geliefertes Paar prüft. So stehen Format und Grenzen nebeneinander und sind ohne Datenbank
testbar.

## Risks / Trade-offs

- [Der Hinweis gilt nur für die letzte Übernahme] → Er verschwindet mit der nächsten Lieferung, die
  den Kopf nicht enthält (`hinweise_fortschreiben`). Das gilt für alle Übernahmehinweise außer „zu
  groß“; das Log behält ihn. Kommt der Kopf wieder mit denselben Zahlen, erscheint er neu.
- [Ein Führer schickt erst gültige, dann ungültige Zahlen] → Das Paar wird leer, die gültigen
  Werte von vorher gehen verloren. Gewollt: Der Spiegel zeigt den Stand des Führers, nicht eine
  Mischung.
- [Legitime Nummer über 999.999] → Nicht erreichbar bei fortlaufender Vergabe je Org und Jahr.

## Migration Plan

Keine Migration. Ein Deploy genügt; schon übernommene Spiegel bekommen die Prüfung mit der nächsten
Lieferung ihres Kopfs.
