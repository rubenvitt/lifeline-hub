# Design

## Context

Motivation: proposal.md, „Why“. Grundlage sind das Lebensende im Abgleich (LLH-1494,
`src/instanz/spiegel/lebensende.rs`), die Führung auf dem Spiegel (LLH-1641) und der Filter aus
LLH-1675 (`fuehrung::repo::list_fremde_der_org`).

Beobachtet am Stand `3d74eba3`:

- **Zwei Leitungen.** Akten reisen in der Meldung (`fuehrung::austausch`, nach `stand`), das
  Lebensende im Abgleich (`SpiegelPaket.lebensende`). Eine Akte verschwindet beim Führer mit ihrem
  Einsatz (`einsatz_fuehrung.einsatz_id … ON DELETE CASCADE`); in der Meldung gibt es dafür kein
  Ereignis, weil eine gelöschte Zeile keinen Stand mehr hat.
- **Beleg nur für das eigene Präfix.** `lebensende::ist_geloescht` liest die Einsatz-ID aus der
  Kennung (`<eigene Kennung>/<id>…`) und sucht sie im Löschprotokoll; dieses trägt keine Kennung.
  Ein Einsatz, den eine Instanz mit fremder Kennung führt (Verwahrung am Hub, Notübernahme,
  Übergabe), ist nach seiner Löschung für niemanden belegbar.
- **Weitergabe geht nur von der erreichten zur meldenden Seite.** `austausch::apply_eingang` legt
  an der erreichten Seite von einer meldenden keine Akte mit fremder Epoche oder fremdem Präfix an
  (`m.epoche.instanz != sender` → übergehen; „neue Akte nicht unter ihrem Präfix“). Der Hub reicht
  dagegen jede Akte der Org an alle ELW weiter (`insert_fremd` vergibt einen neuen Stand,
  `list_zu_senden` geht nach Org). Damit gilt:
  - Eine am Hub gelöschte Akte kommt über ein zweites ELW nicht zurück (Prüfpunkt der Aufgabe).
  - Eine ELW hält Akten von Einsätzen anderer ELW, die sie nur über den Hub kennt. Ihr einziger
    Weg zu einem Löschsignal ist der Hub.
- **Beide Seiten legen bei einer neuen Zuordnung alle Akten der Org neu auf**
  (`repo::create_org_zuordnung` → `renew_stand_der_org`). Nach Widerruf und neuer Zuordnung kommen
  gelöschte Akten also wieder.
- **Wo ein Einsatz endet:** nur in `einsatz::skelett_loeschung::loeschen` und
  `einsatz::abraeumen::ausfuehren`; beide schreiben das Löschprotokoll in der Transaktion des
  `DELETE` (`src/AGENTS.md`, Lebensende).

## Goals / Non-Goals

**Goals:**

- Eine Akte ohne Spiegel verschwindet, wenn ihr Einsatz beim Gegenüber endgültig weg ist: im
  direkten Paar, über den Hub an weitere ELW und beim Widerruf (Spec-Delta `instanz-fuehrung`).
- Gemeldet wird nur mit Beleg; eine zurückgespielte Sicherung löscht beim Gegenüber nichts.
- Ohne neue Protokollversion: ein Feld mit `serde(default)`, die Antwort in der vorhandenen Liste
  `lebensende`.

**Non-Goals:**

- Der Weg über die Stände (`geloeschte(staende)`, `geloescht_uebernehmen` für Spiegel) ändert
  sein Verhalten nicht; `geloescht_uebernehmen` hält zusätzlich das Ende fest (D4). Ein gespiegelter Einsatz mit fremdem Präfix bleibt LLH-1852: Dort räumt die Annahme
  einen ganzen Spiegel unumkehrbar ab.
- Keine gespeicherte Herkunft der Akte (über welche Kopplung sie kam). Der Restfall „ELW an zwei
  Hubs, Akten Dritter über den widerrufenen Hub“ bleibt (proposal.md).
- Kein Live-Ereignis: Betroffen ist kein lokaler Einsatz, und „Einsätze beim Gegenüber“ lädt in
  Abständen nach (`EinsaetzeBeimGegenueber.tsx`, `refetchInterval`).

## Decisions

### D1 Das Signal reist im Abgleich, als Nennung und Antwort

`SpiegelPaket` bekommt `akten: Vec<String>`: Kennungen von Akten ohne lokalen Einsatz, die der
Absender hält. Die Antwort steht in `lebensende` mit der Art `geloescht`, wie beim Spiegel.

- **Pull** (die meldende Seite nennt): `akten` in der Anfrage, `geloescht` in der Antwort.
- **Push** (die erreichte Seite nennt): `akten` in der Antwort, die meldende Seite meldet
  `geloescht` in der nächsten Runde desselben Abgleichs. Das ist der vorhandene Weg
  `geloescht_offen` in `abgleich_einmal`; die belegten Akten kommen zu den belegten Ständen.

Grenzen in `SpiegelPaket::check`: höchstens `EINSAETZE_MAX` Kennungen, jede höchstens
`KENNUNG_BYTES_MAX` Byte (Nachtrag aus dem Review, unten). Sind es mehr Akten,
rückt die Auswahl je Abgleich weiter (`reihum` mit eigenem Zähler, wie bei den Ständen, LLH-1630).

Ein älteres Gegenüber überliest `akten` und antwortet nicht; eine Instanz, die nichts nennt,
bekommt kein `geloescht` für eine Akte. `instanz::PROTOKOLL` bleibt.

**Verworfen: über `staende` mit Platzhalter-Stand.** `liefern::list_gefuehrt` lieferte einen
abgeschlossenen Einsatz dann nach, sobald der Stand unter seinem liegt (Vorgabe der Aufgabe).

**Verworfen: in der Meldung, neben den Akten.** Dort wäre das Signal thematisch zu Hause, aber
der Rumpf der Meldung ist auf 64 KiB begrenzt (`MELDUNG_BYTES` 40 KiB für Akten), und Beleg,
Abräumen und der Rückweg `geloescht_offen` stehen schon im Abgleich. Die Führung setzt seit
LLH-1641 den Spiegel ohnehin voraus.

**Verworfen: Antwort „kenne ich nicht“ statt `geloescht`.** Das käme ohne Beleg aus, aber eine aus
der Sicherung zurückgekehrte Instanz löschte damit Akten beim Gegenüber (Akzeptanzkriterium).

### D2 Wer nennt was

Genannt wird nur bei eingeschaltetem Schalter (`fuehrung::repo::is_enabled_tx`), nur für aktive
Org-Zuordnungen der Kopplung, nur `einsatz_id IS NULL`:

- **Meldende Seite:** alle solchen Akten der Org. Die erreichte Seite kann auch für Einsätze
  Dritter antworten (D4). Hängt die Org an mehr als einem Hub (`list_hubs`), nur Akten, die der
  gefragte Hub selbst führt (Nachtrag aus dem Review, unten).
- **Erreichte Seite:** nur Akten, deren `fuehrer_kennung` das Gegenüber ist. Andere nähme sie von
  ihm nicht an (D3); sie zu nennen kostete je Abgleich eine zusätzliche Runde, wenn das Gegenüber
  zufällig einen Beleg hat (eigenes Präfix, Spiegel nach der Nachbereitung abgeräumt).

Die Abfrage steht in `fuehrung::repo` (`list_ohne_spiegel`), der Abgleich ruft sie an den beiden
Stellen, an denen er heute `eigene_staende` baut. Wem genannt wird und von wem angenommen wird
(D3), sagt eine Funktion für beides: `fuehrung::repo::is_gegenueber_zustaendig`.

### D3 Wer was annimmt

`lebensende::geloescht_uebernehmen` entscheidet wie bisher (Präfix des Gegenübers, Spiegel dieser
Kopplung → `abraeumen::vormerken`) und schreibt dabei den Vermerk (D4). Daneben, nur bei eingeschaltetem Schalter, eine eigene
Funktion für Akten (`lebensende::geloeschte_akten_uebernehmen`):

Die Akte mit der Kennung wird gelöscht, wenn sie keinen lokalen Einsatz hat, ihre Org dieser
Kopplung aktiv zugeordnet ist und, an der erreichten Seite, ihr `fuehrer_kennung` das Gegenüber
ist. Der Verlauf geht über die Kaskade mit. In derselben Transaktion entsteht der Löschvermerk
(D4). Alles andere wird still übergangen.

Die erreichte Seite schützt damit die Akten anderer ELW, wie `apply_eingang` deren Führung
schützt. Die meldende Seite vertraut der erreichten für diese Akten ohnehin: Sie legt jede Akte
an, die der Hub schickt.

**Verworfen: nur annehmen, was in diesem Austausch genannt wurde.** Im Pull ließe sich das prüfen,
im Push nicht (die Nennung stand in der vorigen Antwort). Die Regel oben trägt beide Richtungen.

### D4 Löschvermerk je Kennung

Neue Tabelle (Migration `0339`, anhängend, Blatt, ohne Marker):

```sql
CREATE TABLE fuehrung_loeschvermerk (
    kennung     TEXT    PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    vermerkt_at TEXT    NOT NULL
);
```

Modul `instanz::fuehrung::loeschvermerk`. Geschrieben wird in der Transaktion, die den Anlass
festschreibt (`INSERT … ON CONFLICT (kennung) DO UPDATE`):

| Anlass | Stelle |
| --- | --- |
| Einsatz endgültig gelöscht (Skelett) | `einsatz::skelett_loeschung::loeschen`, neben der Protokollzeile |
| Verwahrter Einsatz abgeräumt | `einsatz::abraeumen::ausfuehren`, neben der Protokollzeile |
| Führer meldet einen Spiegel gelöscht | `lebensende::geloescht_uebernehmen`, beim Vormerken |
| Akte auf ein Signal hin gelöscht | `lebensende::geloeschte_akten_uebernehmen` (D3) |
| Akte beim Widerruf gelöscht | `fuehrung::repo::release_nach_widerruf` (D5) |

Die beiden letzten löschen über `fuehrung::repo::delete_ohne_spiegel`, das den Vermerk schreibt:
Eine Akte ohne Einsatz verschwindet auf keinem anderen Weg.

Die drei ersten lesen Kennung und Org vom Einsatz (`einsatz.kennung`, beim Spiegel die Kennung
des Führers); ohne Kennung entsteht kein Vermerk (nie geliefert, keine Akte, Demo-Einsatz).

**Beleg** (`lebensende::geloeschte_akten`): Eine genannte Kennung gilt als gelöscht, wenn hier
weder ein Einsatz noch eine Akte mit ihr steht und

- ein Vermerk mit ihr steht, dessen Org dieser Kopplung aktiv zugeordnet ist
  (`loeschvermerk::belegte`, eine Abfrage über die genannte Liste per `json_each`), oder
- `lebensende::is_altbestand_geloescht` sie belegt (eigenes Präfix, ID im Löschprotokoll einer
  der Kopplung zugeordneten Org, Art nicht `spiegel`): der Bestand von vor dieser Change, je
  Kennung mit eigenem Präfix geprüft.

„Keine Akte hier“ macht einen alten Vermerk wirkungslos, sobald die Akte wieder kommt (neue
Zuordnung, neuer Stand beim Führer). Vermerke werden deshalb nie gelöscht; sie sind so klein und
so dauerhaft wie das Löschprotokoll und tragen nur die Kennung (Instanzkennung, ID, Zufallsteil),
keinen Inhalt des Einsatzes.

Kein Vermerk entsteht, wenn die meldende Seite einen Spiegel nach der Nachbereitung abräumt
(Phase R): Der Einsatz lebt beim Führer weiter. Der Entwurf hielt einen Vermerk dort zuerst für
unschädlich, weil eine meldende Seite nur nach Akten gefragt werde, die sie führt. Das stimmt
nicht für eine Instanz, die sich bei einer meldet und von einer anderen erreicht wird (die Spec
`instanz-kopplung` lässt das zu): Sie hätte ihrer meldenden Seite einen lebenden Einsatz als
gelöscht gemeldet (Review vor dem PR). Aus demselben Grund zählt im Beleg aus dem Löschprotokoll
die Art `spiegel` nicht, und er gilt nur für eine Org, die der fragenden Kopplung zugeordnet ist.

**Verworfen: Spalte `kennung` am Löschprotokoll.** Sie deckte die Löschung eines Einsatzes, nicht
aber eine Akte, die ohne Einsatz gelöscht wird (`einsatz_id` ist dort Pflicht und eindeutig); die
Weitergabe über den Hub bräuchte dann doch eine zweite Ablage.

**Verworfen: Vermerk per Trigger an `einsatz_fuehrung`.** Er feuerte auch bei der Kaskade einer
gelöschten Org und beim Neubau der Tabelle in einer Migration; die fünf Stellen oben sind
ausdrücklich und prüfbar.

### D5 Widerruf

`fuehrung::repo::release_nach_widerruf(org_id, gegenueber_kennung)` löscht zusätzlich die Akten
der Org mit `einsatz_id IS NULL AND fuehrer_kennung = gegenueber_kennung` und vermerkt sie (D4).
Das gilt an beiden Seiten: Die erreichte Seite kennt von einer meldenden nur deren eigene Akten,
die meldende verliert die Akten, die der widerrufene Hub selbst führt. Akten Dritter, die über
diesen Hub kamen, bleiben (proposal.md, Restfall); sind sie die letzten der Org, blendet sie der
Filter aus LLH-1675 weiter aus.

Der Vermerk lässt weitere meldende Seiten derselben Org die Akten verlieren (D4, Beleg), und die
neue Zuordnung bringt sie zurück (`renew_stand_der_org` beim Gegenüber, dann `insert_fremd` und
Weitergabe).

Der Filter in `list_fremde_der_org` bleibt, sein Kommentar verliert den Verweis auf LLH-1699.

### D6 Die Entscheidung steht als ADR-0036

Nach `docs/architektur/AGENTS.md` (Mitänderungsregel) bekommt eine Entscheidung der Route
`entwurf` eine ADR: `ADR-0036` hält die Regeln aus D2–D4 mit Prüfung fest; Laufzeitsicht (6) und
Glossar (12) nennen Ablauf und Begriff.

### Nachträge aus dem Review vor dem PR (12.11.2026)

- **Zwei Hubs (D2, D3):** Hängt die Org einer meldenden Seite an zwei Hubs, nähme ihr ein Hub mit
  seinem Vermerk (Widerruf gegen den Führer, abgeräumter Spiegel) eine Akte, die sie über den
  anderen weiter erreicht, und bei jeder Neulieferung wieder. Sie nennt einem Hub deshalb nur
  noch Akten, die er selbst führt, und nimmt nur für diese an. Akten Dritter bleiben dort stehen
  (proposal.md).
- **Grenze der genannten Kennungen (D1):** in Byte (`paket::KENNUNG_BYTES_MAX`, 200) statt 500
  Zeichen, längere werden nicht genannt, und das Feld geht vom Budget der Zeilen ab. Sonst
  sprengten überlange Kennungen einer fehlerhaften Instanz, vom Hub weitergereicht, das Paket
  jeder anderen ELW.
- **Vermerk nur am Ende eines Einsatzes (D4):** siehe dort.
- **Nachprüfung der Behebung:** Kennungen werden nur genannt, wenn sie druckbares ASCII sind
  (`paket::is_kennung_nennbar`): Ein Steuerzeichen belegt im JSON sechs Byte und unterliefe die
  Rechnung. `paket::ZEILE_MAX` sinkt um `AKTEN_BYTES_MAX`, damit dem ersten Einsatz eines Pakets
  weiter eine ganze Zeile bleibt; beide Budget-Stellen rechnen über `budget_fuer_zeilen`. Der
  Führer entscheidet auch dann allein, wenn er selbst ein Gegenüber der Org ist (eine Instanz,
  die sich bei einem Hub meldet und von einer ELW erreicht wird). Restfall Kette: proposal.md.
- **Schalter (D5):** Der Widerruf löscht die Akten ohne Spiegel nur bei eingeschaltetem Schalter.
  Zuerst löschte er unabhängig davon; beim Einholen von `alpha` kam LLH-1704 dazu (ohne Schalter
  ist die Führung eingefroren, der Widerruf holt nichts zurück), und die Akten folgen derselben
  Regel. Nach dem Wiedereinschalten bleiben solche Akten stehen, bis das Gegenüber neu
  zugeordnet ist oder ihr Führer sie als gelöscht meldet.

## Risks / Trade-offs

- **Falsches `geloescht` löscht eine Anzeige** → Betroffen ist nur eine Akte ohne lokalen Einsatz;
  Daten eines Einsatzes gehen nie verloren. Ändert sich die Akte beim Führer, kommt sie wieder.
  Die erreichte Seite nimmt das Signal nur von dem an, den die Akte als Führer nennt.
- **Löschungen von vor dieser Change mit fremdem Präfix bleiben unbelegt** → Diese Akten bleiben
  stehen wie bisher; für das eigene Präfix trägt das Löschprotokoll.
- **Hunderte Akten ohne Spiegel** (eine Org mit langem Bestand koppelt neu) → je Abgleich
  höchstens `EINSAETZE_MAX` Kennungen, reihum; der Beleg ist eine Abfrage, nicht eine je Kennung.
  Bei aktivem Einsatz läuft der Abgleich alle fünf Sekunden, das Feld kostet dann bis etwa 10 KiB
  je Runde bei 2 MiB Paketgrenze.
- **Zusätzliche Runde im Push** → nur wenn die meldende Seite etwas belegt; danach ist die Akte
  an der erreichten Seite gelöscht und wird nicht mehr genannt.
- **Widerruf löscht statt auszublenden** → anders als LLH-1675 (nur Filter). Die neue Zuordnung
  stellt die Akten wieder her; der Verlauf einer Akte ohne Spiegel beginnt dann neu.

## Migration Plan

- `0343_fuehrung_loeschvermerk.sql` legt nur die Tabelle an; vor dem Push `git fetch origin alpha`
  und `scripts/check-migrationen.sh`.
- Gemischter Betrieb: Eine neue Instanz neben einer älteren nennt Akten und bekommt keine Antwort;
  die ältere nennt nichts. Kein Schritt hängt an der Reihenfolge der Updates.
- Rückweg: Der Stand davor überliest das Feld; die Tabelle bleibt ungenutzt stehen.
