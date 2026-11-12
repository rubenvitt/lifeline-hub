# Design

## Context

Einsatznummern sind je Organisation eindeutig (`idx_einsatz_nummer`, `idx_einsatz_nummer_lfd`).
Seit dem Nachtrag D4 der Change `polrv1lt-spiegel-antraege` gelten beide Indizes nur für eigene
Einsätze (`WHERE spiegel = 0`, `migrations/0314_einsatz_spiegel.sql`): ELW und Hub vergeben
unabhängig, ein Spiegel trägt die Nummer seines Führers. Die Anlage zählt Spiegel bei der
laufenden Nummer nicht mit (`einsatz::repo::anlegen_tx`, LLH-1630).

`einsatz.spiegel` folgt der Zeile in `einsatz_spiegel` über zwei Trigger. Einen Spiegel zum eigenen
Einsatz machen zwei Wege:

1. **Führungswechsel:** `instanz::spiegel::fuehrung::werde_fuehrer` löscht die Zeile. Die Funktion
   läuft aus `richte_aus`, das jedes `fuehrung::repo::save` und `insert_fremd` ruft. Damit sind
   alle Wege betroffen, die diese Instanz zum Führer machen: die drei Notübernahmen
   (`dienst::notuebernahme_gegen_erreichte`, `notuebernahme_gegen_meldende` mit Unterschrift oder
   Code), die eingehende Akte einer Übergabe oder erfüllten Anfrage (`austausch::apply_eingang`,
   Zweig `gewinne`), `release_nach_widerruf` und `richte_alle_aus` beim Start.
2. **Verwahrung:** `instanz::spiegel::lebensende::umwandeln`. Nur dieser Weg ruft vorher
   `nummer_freimachen` (LLH-1647) und nennt die Umnummerierung in seinem ETB-Eintrag.

Auf Weg 1 fehlt die Nummernvergabe. Der Trigger setzt `spiegel = 0`, der Index schlägt an, und
`AppError::status()` macht aus dem UNIQUE-Fehler den 409 „Ein Eintrag mit diesen Werten existiert
bereits.“ Nachgestellt mit zwei gekoppelten Instanzen im Test
`notuebernahme_bei_gleicher_einsatznummer` (`tests/instanz_fuehrung_live.rs`): Der Hub hat
`E-2026-0001` und `E-2026-0002` eigen und `E-2026-0001` als Spiegel.

Zwei Beobachtungen bestimmen den Entwurf:

- Im Abgleich reicht `apply_eingang` den Fehler mit `?` durch. Eine Übergabe an eine Seite mit
  belegter Nummer lässt also die ganze Meldung scheitern, in jedem Takt wieder.
- Der Fall ist nicht selten. Gibt der ELW seinen ersten Einsatz `E-2026-0001` an den Hub ab und
  legt danach einen neuen an, bekommt dieser wieder `E-2026-0001`, weil Spiegel nicht mitzählen.
  Holt der ELW den ersten Einsatz zurück, kollidieren die beiden.

## Goals / Non-Goals

**Goals:**

- Jeder Übergang vom Spiegel zum eigenen Einsatz gelingt auch bei belegter Nummer.
- Eine Stelle im Code trägt das für alle Wege des Führungswechsels.
- Die Umnummerierung ist im Einsatztagebuch nachlesbar und kommt an der abgebenden Seite an.
- Führungswechsel und Verwahrung benutzen dieselbe Nummernvergabe.

**Non-Goals:**

- Abgestimmte Nummernkreise über Instanzen (bleibt Risiko R30).
- Die frühere Nummer bei einem Rückwechsel wiederherstellen.
- Eine sprechende Fehlermeldung an den Notübernahme-Routen.
- Änderungen an Oberfläche, Leitung oder Schema.

## Decisions

### D1 Umnummerieren in `werde_fuehrer`, vor dem Löschen der Spiegel-Zeile

`werde_fuehrer` ruft die Nummernvergabe, bevor es `einsatz_spiegel` löscht. So trägt eine Stelle
alle Wege aus dem Context, auch künftige, die über `save` laufen.

Der Einsatz ist an dieser Stelle noch Spiegel, sein Schutz-Trigger verlangt also den Merker
`spiegel_uebernahme`. `werde_fuehrer` setzt ihn für die eine Anweisung und nimmt ihn wieder, wenn
er vorher nicht stand (Muster `merker_vorher` aus `werde_spiegel`). Im Verwahrungsweg steht der
Merker schon und bleibt.

Verworfen:

- **Sprechende 409/422 vor der Transaktion** (Vorschlag aus der Aufgabe): hilft nur an den
  Notübernahme-Routen. Die empfangende Seite einer Übergabe oder Anfrage hat keinen Menschen, der
  die Meldung liest, und die Kopplung bliebe hängen.
- **In den Routen der Notübernahme umnummerieren:** deckt Übergabe, Anfrage und Widerruf nicht.
- **Im Trigger `einsatz_spiegel_merker_d`:** die Nummernvergabe braucht Präfix, Zeitzone und eine
  Schleife über belegte Texte; das gehört nicht in SQL und bräuchte eine Migration.

### D2 Eine Nummernvergabe für beide Wege

`nummer_freimachen` zieht aus `lebensende.rs` in ein eigenes kleines Modul
`src/instanz/spiegel/nummer.rs` und heißt dort `ensure_freie_nummer` (Bezeichner-Sprache: der
Ablauf englisch, „freie Nummer“ bleibt deutsch). Verhalten unverändert: belegt ist die Nummer, wenn
ein eigener Einsatz der Organisation oder das Löschprotokoll denselben Text oder dieselbe laufende
Nummer des Jahres trägt; die neue laufende Nummer liegt über allen Einsätzen (auch Spiegeln) und
dem Löschprotokoll des Jahres, belegte Texte werden übersprungen. Das weicht bewusst von der
Anlage ab, die seit LLH-1630 nur eigene Einsätze zählt: Die neue Nummer soll keinem Spiegel
gleichen, der später selbst eigen werden kann und dann wieder umnummeriert würde. Der Preis sind
Lücken im eigenen Nummernkreis (im Review am 12.11.2026 als Frage aufgekommen, so belassen). Ergebnis `Some((alt, neu))` bei
einer Umnummerierung. Das Verschieben ist ein eigener `refactor`-Commit ohne Verhaltensänderung.

`lebensende::umwandeln` ruft die Funktion weiter selbst vor `verwahren`: Ohne Schalter
`LIFELINE_FUEHRUNG` läuft `werde_fuehrer` gar nicht, und der Verwahrungs-Eintrag braucht die
beiden Nummern für seinen Text. Mit Schalter findet `werde_fuehrer` danach eine freie Nummer und
tut nichts; ein zweiter Eintrag entsteht nicht.

### D3 Der übernommene Stand wird vor der Umnummerierung gelesen

`werde_fuehrer` merkt sich in `uebernommen_stand`, bis wohin der alte Führer die Zeilen kennt. Der
Wert wird wie heute zuerst gelesen, die Umnummerierung folgt danach. Die Kopfänderung liegt damit
über dem übernommenen Stand. Für einen Rückfall zum Spiegel ändert das nichts: `sichere_bruchstelle`
lässt den Kopf (`art = 'einsatz'`) ohnehin aus, er kommt vom neuen Führer.

Die abgebende Seite bekommt die neue Nummer ohne neuen Code: Ihr Spiegel beginnt bei Stand 0
(`werde_spiegel`), der neue Führer liefert alles samt Kopf. Die Akte (`einsatz_fuehrung.nummer`)
zieht `ensure_akten` vor der nächsten Meldung nach. Beides belegt ein Test, nicht eine Annahme.

### D4 Systemeintrag im Einsatztagebuch, ohne Akteur kein Eintrag

Nach dem Löschen der Spiegel-Zeile schreibt `werde_fuehrer` bei einer Umnummerierung einen
Systemeintrag über `etb::system_audit_tx`:

> Neue Einsatznummer E-2026-0003, bisher E-2026-0001: Die bisherige ist an dieser Installation
> schon vergeben.

Der Text trägt nur die beiden Nummern, keine Scrub-Werte (`src/AGENTS.md`, „Scrub-Werte in
System-ETB-Texten“). Akteur ist `einsatz::repo::ermittle_system_akteur` (abschließende Person,
Einsatzleitung, System-Admin der Einsatz-Org), wie bei der Verwahrung.

Findet sich kein Akteur, entfällt der Eintrag, und der Wechsel gelingt trotzdem (Warnung im Log).
Das weicht bewusst von der Verwahrung ab, die in diesem Fall wartet: Eine Verwahrung kann warten,
eine Notübernahme nicht, und ein Abbruch im Abgleich wäre wieder der Fehler dieser Aufgabe.

Die Akte (`einsatz_fuehrung.nummer`) zieht `werde_fuehrer` bei einer Umnummerierung gleich mit,
und `fuehrung::repo::save` liest sie danach neu: Antwort und Admin-Spur der Notübernahme nennen den
Einsatz so mit seiner neuen Nummer, nicht mit einer, die hier ein anderer Einsatz trägt.

Live (Nachtrag aus dem Review, 12.11.2026): Der Kopf allein reicht nicht, denn das Ereignis
`einsatz` lädt im Client weder das ETB noch den Modulzähler neu, und die ID des Eintrags erreicht
keinen Aufrufer von `save`. Jeder Führungswechsel an einem lokalen Einsatz meldet deshalb neben
dem Kopf einen Vollabgleich (`lagged`, `fuehrung::notify_wechsel`), wie jede Lieferung im Abgleich
(`spiegel::abgleich::melde_live`). Verworfen: die ID durch `werde_fuehrer`, `richte_aus`, `save`
und die Dienste reichen (etwa zehn Signaturen für ein Ereignis je Führungswechsel).

Verworfen (am 12.11.2026 mit Ruben): die Spur nur im Führungsverlauf (nur an der Instanz sichtbar,
die umnummeriert hat, und nicht dort, wo Einsatzkräfte lesen) und gar keine Spur.

### D5 Kein Rücktausch der Nummer

Wechselt die Führung zurück, behält der Einsatz seine aktuelle Nummer, solange sie dort frei ist;
sonst bekommt er wieder eine freie. Eine „Heimatnummer“ je Instanz bräuchte ein neues Feld und
eine Regel für drei Instanzen. Der ETB-Eintrag hält jede Änderung fest.

### D6 Spec-Ort: `einsatznummer`

Die Anforderung steht in der Spec `einsatznummer`, nicht in `instanz-fuehrung` (so am Checkpoint
angekündigt): Dort steht „unveränderlich“, und die Regel gilt gleich für Führungswechsel und
Verwahrung. `instanz-fuehrung` bleibt unverändert.

## Risks / Trade-offs

- **Bruchstelle nach zurückgewiesener Notübernahme** → Weist die meldende Seite eine Notübernahme
  zurück (Widerspruch), fällt die übernehmende Seite zum Spiegel zurück. Der Systemeintrag zur
  Nummer ist dann eine eigene Änderung, die der Führer nicht kennt, und wird als Bruchstelle
  gesichert; die Nummer kommt mit dem nächsten Kopf des Führers zurück (Test
  `nach_widerspruch_traegt_der_hub_spiegel_wieder_die_nummer_des_elw`).
  **Nachtrag aus der Umsetzung (12.11.2026):** Diese Bruchstelle wird heute nie geklärt, wenn der
  Führer den Einsatz selbst nie gespiegelt hat (`beantworte_bruch` antwortet `kennt: false`). Die
  Zeile bleibt am Spiegel stehen, und ein späterer ETB-Eintrag des Führers mit derselben laufenden
  Nummer kommt dort nicht an. Der Fehler besteht unabhängig von dieser Change für jede Erfassung
  der übernehmenden Seite (ohne die Change nachgestellt) und ist LLH-1854. Mit Ruben abgestimmt:
  Der Systemeintrag bleibt, LLH-1854 behebt die Bruchstelle. Bis dahin läuft auch eine
  umnummerierte Notübernahme ohne weitere Erfassung in diesen Fehler, sobald ihr widersprochen
  wird; ohne die Change scheiterte derselbe Fall schon an der Notübernahme selbst.
- **Die Nummer eines Einsatzes kann mehrfach wechseln** (hin und zurück bei beidseitig belegten
  Nummern) → selten, jede Änderung steht im Einsatztagebuch; abgestimmte Nummernkreise bleiben als
  R30 offen.
- **Akteur kann ein Stellvertreter-Konto sein** (gespiegelte Mitgliedschaft der Einsatzleitung) →
  wie bei der Verwahrung; der Eintrag ist ein Systemeintrag, der Akteur nur der Pflicht-Fremdschlüssel.
- **Mehrere Umnummerierungen in einer Transaktion** (`richte_alle_aus`) → jede sieht die vorige,
  weil die Vergabe über alle Einsätze der Organisation zählt.

## Migration Plan

Keine Migration, kein Schalter. Bestehende Daten ändern sich nicht: Umnummeriert wird nur beim
nächsten Übergang eines Spiegels mit belegter Nummer. Eine Kopplung, deren Abgleich heute an diesem
Fehler hängt, läuft mit dem Update von selbst weiter. Rückweg: Revert des Commits; schon
umnummerierte Einsätze behalten ihre Nummer.

## Open Questions

Keine.
