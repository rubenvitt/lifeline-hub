# Design

## Context

Die Motivation steht in `proposal.md`. Die Durchsicht vom 02.10.2026 hat die 63 Einträge von
`AUSNAHMEN_SYSTEM_ETB` gegen den Code abgeglichen. Für diese Änderung zählen davon:

- **Schaden:** Bei der Anlage schreibt `routes/einsatz_schaden.rs::anlegen`
  „Schaden S-001 angelegt: {typ} ({ausmass}) — {ort_kurz(ort)}“. Bei der Übergabe schreibt
  `::uebergeben` „Schaden S-001 übergeben an {adressat}“. `ort_kurz` hat keinen anderen Aufrufer.
- **Verbleib:** `routes/einsatz_person.rs::verbleib` schreibt
  „Person R-001: {VerbleibArt::etb_sachverhalt(ziel)}“, also „abtransportiert → {ziel}“ oder
  „in Notunterkunft → {ziel}“. Drei Listeneinträge (`person_verbleib.ziel`,
  `einsatz_person.aktuelles_verbleib_ziel`, `einsatz_person.aktueller_verbleib`) hängen an
  diesem einen Wert. Die Kurzform `VerbleibArt::kurzform` für die Personenzeile ist kein
  ETB-Text und bleibt.
- **UHS:** Beim manuellen Austritt hängt `routes/einsatz_uhs.rs::formatiere_belegungs_etb` die
  Notiz an („verlässt BHP 50 ({notiz})“). Der automatische Austritt (`uhs/hooks.rs`) setzt dort
  einen festen Anlass ein („durch Verbleib transport“). Das ist kein Scrub-Wert, und dieser
  Austritt bleibt unverändert.
- **Dokument:** Alle drei Schreibwege in `dokument/repo.rs` nennen den Titel:
  - `ablegen`: „Dokument abgelegt: {titel} ({kategorie})“,
  - `aendern`: „Dokument geändert: {titel} ({kategorie}) — Titel: „{alt}“ → „{neu}“; …“,
  - `entfernen`: „Dokument entfernt: {titel} ({kategorie})“.

  `aendern` fehlt bisher in der Liste. Beim Schwärzen löscht die Registry die Zeile
  `einsatz_dokument` vollständig, auch ihre `id`. `einsatz_dokument.etb_eintrag_id` ist
  NOT NULL und zeigt auf den Ablage-Eintrag. Dessen laufende Nummer bleibt im ETB erhalten.
- **Frontend:** Das Frontend parst keinen System-Text. Es zeigt `inhalt` als reinen Text an,
  und die e2e-Suite prüft nur das Präfix „Dokument geändert:“.
- **ETB:** Das ETB ist append-only. Bestehende Einträge werden nie umgeschrieben.

## Goals / Non-Goals

**Goals:**
- Neue System-Einträge der vier Schreibwege für Betroffene und der drei Dokument-Schreibwege
  übernehmen keinen Scrub-Wert mehr.
- Die Ausnahmeliste schrumpft von 63 auf 56 Einträge:
  - minus 6 für Betroffene,
  - minus 2 für die Dokumenttitel,
  - plus 1 für die bisher fehlende Kategorie in `aendern`.

  Jeder Eintrag trägt eine Gruppe, und für gesperrte Spalten wacht ein Test.
- Mindestens ein behaltener Wert bleibt im Ende-zu-Ende-Ablauf gepflanzt und gepinnt. Sonst
  prüft der Mechanismus „genau dort und nirgends sonst“ nichts mehr.

**Non-Goals:**
- Bestehende ETB-Einträge umschreiben oder bei der Schwärzung nachträglich bereinigen.
- Die behaltenen Gruppen (Einsatzkräfte, Lage-Labels, Führungsmodule) umformulieren.
- Die Durchsicht durch einen Guard ersetzen, der jede neue Übernahme eines Scrub-Werts
  maschinell findet. Das bräuchte eine Analyse des Datenflusses. Der neue Selbsttest sperrt
  nur Spalten, er findet keine Fundstellen.
- Eine Nummer je Einsatz für ad-hoc externe Kräfte oder Dokumente einführen. Das wäre eine
  Migration.

## Decisions

### D1 — Betroffene nur über Registriernummer und Enum

Die Regel aus „Pseudonyme Spur im ETB“ gilt jetzt auch für die übrigen Scrub-Werte der
Betroffenen. Neuer Wortlaut:

| Schreibweg | bisher | neu |
| --- | --- | --- |
| Schaden anlegen | `Schaden S-001 angelegt: sturm (mittel) — Birkenallee 9` | `Schaden S-001 angelegt: sturm (mittel)` |
| Schaden übergeben | `Schaden S-001 übergeben an Bauhof` | `Schaden S-001 übergeben` |
| Verbleib Transport | `Person R-001: abtransportiert → KH Mitte` | `Person R-001: abtransportiert` |
| Verbleib Notunterkunft | `Person R-001: in Notunterkunft → Turnhalle Ost` | `Person R-001: in Notunterkunft` |
| UHS-Austritt manuell | `Person R-001: verlässt BHP 50 (an Hausarzt)` | `Person R-001: verlässt BHP 50` |

`VerbleibArt::etb_sachverhalt` verliert den Parameter `ziel`. Der Typ macht so unmöglich, dass
ein Aufrufer das Ziel wieder hineinreicht. Den Wortlaut ohne Ziel gibt es heute schon, wenn
kein Ziel erfasst ist (LFH-613). `ort_kurz` entfällt samt Unit-Test.

**Verworfen:**
- **Ziel bei der Notunterkunft über die verknüpfte Betreuungsstelle nennen.** Deren
  Bezeichnung ist selbst Scrub. Das ergäbe einen neuen Listeneintrag und widerspräche „wird nie
  länger“.
- **Schadensort als Gemeinde oder Straße ohne Hausnummer kürzen.** Das braucht einen Parser für
  Freitext, und der Wert bliebe ein Teil des Scrub-Werts.

### D2 — Dokumente über den Ablage-Eintrag bezeichnen

| Schreibweg | neu |
| --- | --- |
| ablegen | `Dokument abgelegt (Lagekarte/Plan)` |
| ändern | `Dokument geändert: Ablage ETB 12 (Befehl) — Titel geändert; Kategorie: Sonstiges → Befehl; Bezug: ohne → Abschnitt Nord` |
| entfernen | `Dokument entfernt: Ablage ETB 12 (Lagekarte/Plan)` |

„ETB 12“ ist die laufende Nummer des Eintrags, auf den `einsatz_dokument.etb_eintrag_id`
zeigt. Sie ist Retain und bleibt nach der Schwärzung lesbar. So bleiben Ablage, Änderung und
Entfernung im ETB einander zuordenbar. Beim Ablegen ist der Eintrag selbst die Ablage und
braucht keinen Verweis. Die Formulierung „ETB 12“ folgt `bezug_label`, das ETB-Bezüge schon
heute so nennt. Der Bezug in `aendern` behält seine Labels: Abschnitts- und Einheitsnamen
gehören zur Gruppe Lagestruktur und sind nicht Scrub der Dokumentzeile.

**Verworfen:**
- **„Dokument #id“.** Die Registry löscht die `id` mit der Zeile, danach zeigt der Verweis
  ins Leere. Präzedenz ist nur `bezug_label` für verschwundene Ziele.
- **Gar kein Verweis.** Dann ließe sich eine Entfernung keiner Ablage mehr zuordnen.
- **Titel kürzen oder hashen.** Kürzen lässt Personenbezug übrig. Ein Hash ist für Menschen
  wertlos.

### D3 — Liste mit Gruppe und Sperrliste

`Ausnahme` bekommt ein Feld `gruppe` mit den vier behaltenen Gruppen (`Einsatzkraft`,
`Lagestruktur`, `Fuehrungsmodul`, `EnumLabel`). Der Selbsttest
`ausnahmeliste_zeigt_auf_existierende_scrub_stellen` prüft zusätzlich zwei Dinge:
- Keine Spalte der Liste liegt in einer gesperrten Tabelle der Betroffenen: `einsatz_schaden*`,
  `einsatz_person`, `person_*`, `einsatz_tier`.
- Die Liste enthält `einsatz_dokument.titel` nicht.

Der Zweck eines behaltenen Eintrags steht in seiner `gruppe`: im Doc-Kommentar jeder Variante
und im Abschnittskommentar der Liste. Die `begruendung` bleibt die Beschreibung der Fundstelle.
Eine eigene Zweckangabe in jedem der 55 Texte würde nur wiederholen, was die Gruppe schon sagt.
Der neue Eintrag `dokument/repo.rs::aendern` mit
`einsatz_dokument.kategorie` gehört zur Gruppe `EnumLabel`.

**Verworfen:** Eine Obergrenze für die Länge der Liste als Zahl im Test. Sie würde bei jedem
legitimen Abbau angepasst werden müssen und hält die Gruppen nicht auseinander.

### D4 — Ende-zu-Ende-Pinning umstellen

`AUSNAHME_WERTE` hält heute drei gepflanzte Werte aus der Gruppe Betroffene (`Birkenallee-9`,
`Dachdecker-Ruehl`, `Klinikum-Nordstadt`). Sie wandern nach `GEHEIM` und dürfen nach der
Schwärzung nirgends mehr stehen. Damit `AUSNAHME_WERTE` nicht leer läuft, legt der Ablauf
zusätzlich eine Zone mit dem Label `Sperrzone-Lindenplatz` an, Gruppe Lagestruktur. Der Test
erwartet dieses Label genau im Anlage-Eintrag der Zone. Der Ablauf übergibt außerdem den
Schaden und erfasst den Verbleib wie bisher, sodass die drei Werte wirklich durch die
Schreibwege laufen.

### D5 — Kein Rückbau des Bestands

Keine Migration und kein Umschreiben bei der Schwärzung. Das ETB ist append-only (G_ETB),
und ein nachträglich geänderter Eintrag wäre selbst ein Bruch der Führungsdokumentation. Alte
Einsätze behalten ihren Wortlaut. Die Spec hält das im Szenario „Dokumentierte Ausnahme Schadensort“ fest.

## Risks / Trade-offs

- [Das ETB im laufenden Einsatz nennt die Klinik, den Übergabe-Adressaten und den Schadensort
  nicht mehr] → Die Werte stehen weiter im Personen- bzw. Schadenmodul und in der Lagekarte.
  Die Koordinate des Schadens ist Retain. Das gehört in die Abschlussmeldung, weil Bediener es
  bemerken werden.
- [Die Volltextsuche im ETB findet einen Schaden oder Patienten nicht mehr über Ort oder
  Klinik] → Die Suche über die Registriernummer funktioniert weiter.
- [Eine neue Übernahme eines Scrub-Werts bleibt unbemerkt] → Das gilt unverändert, siehe
  Non-Goals. Die Sperrliste deckt nur die Gruppen ab, die ganz ausgeschlossen sind.

## Migration Plan

Die Änderung ist reiner Code. Der Rückweg ist ein Revert, und neue Einträge haben dann wieder
den alten Wortlaut. Es gibt keine Daten zum Zurückbauen.
