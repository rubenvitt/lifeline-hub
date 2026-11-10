# Schnittstellen-Ausbau: Alarme, Stammdaten, Austausch, Kanäle nach außen

Stand: 10.11.2026 · Konzeptnotiz, kein Code · Zunder LLH-1191
(`https://zunder.rubeen.dev/#/aufgabe/zgid72wiedtiyporllsd4rxq`)

Ausführliche Fassung mit Belegen, Feldtabellen und Quellen:
https://claude.ai/artifact/6oLL33dyWwX6MzSBxkGZF3 (08.11.2026). Dieses Dokument hält fest, was
Ruben am 10.11.2026 entschieden hat und was daraus folgt. Grundlage sind sieben Recherchen: zwei
im Repo (Eingangsseite, Fachmodule), vier im Web (Alarmdaten-Ökosystem, Personal/HiOrg/PASS,
Austausch und Kanäle, Stufe 3 und Recht) und eine zur iuk-suite.

## Grundsatz: alles sind Adapter

Lifeline Hub legt für jede Richtung **einen neutralen Vertrag** fest. Jede konkrete Anbindung
(BOSWatch, FE2, Divera, HiOrg, iuk-suite, ein eigener Pager, Meshtastic …) ist ein **Adapter**, der
in diesen Vertrag übersetzt und sonst keine Sonderrechte hat. Im Kern stehen keine Herstellernamen.
Erst die Verträge herausarbeiten, dann Adapter schreiben.

| Vertrag | Richtung | Inhalt |
| --- | --- | --- |
| Alarmmeldung | herein | Normalform eines Alarms → Einsatzvorschlag |
| Stammdaten | herein | Personal, Qualifikationen, Fahrzeuge, Funkgeräte mit Kennung + Herkunft |
| Position | herein | letzte Position eines Fahrzeugs oder Geräts |
| Ausgang | hinaus | Nachricht an eine Stelle über einen Kanal, mit Ausgangsnachweisung |
| Geodaten | beide | GeoJSON/KMZ/GPX, Fremdebene aus Datei oder URL |
| Lesen | hinaus | Lagebild, Einsatzkopf für Fremdsysteme (LLH-1148) |

## Leitplanken

- **G1 Ein Mensch entscheidet.** Kein Einsatz ohne Menschen, kein Versand ohne Menschen, kein
  stiller Nachtrag.
- **G2 Funkempfang bleibt beim Kunden** (§ 5, § 27 TDDDG). Nur eigene RIC/ISSI, Freigabe des
  Aufgabenträgers am Zugang.
- **G3 Ein Verfahren für Maschinen** (ADR-0014); Ausnahmen nur ausdrücklich in eigener ADR.
- **G4 Neutraler Vertrag, Adapter übersetzen** (siehe oben).
- **G5 Eingehendes kommt am Hub an** (Instanzkopplung, Entscheidung 12); eine ungekoppelte
  Instanz verhält sich wie ein Hub.
- **G6 Was Lifeline Hub nicht braucht, nimmt es nicht an** (Patientenfelder, IBAN, Ernährung).
- **G7 Kein stiller Fehler:** Zustand jedes Adapters im Admin-Bereich.
- **G8 Ohne Netz merkt der Server vor:** Ausgangskorb am Server, Abrufe im Hintergrund.

## Entscheidungen (10.11.2026)

| Nr. | Frage | Entscheidung |
| --- | --- | --- |
| E1 | Absender ohne Signatur (BOSWatch, FE2 „URL öffnen“, Divera-Webhook, OsmAnd) | **Einwurf-Zugang:** geheimer Schlüssel im Pfad, darf nur in eine Ablage schreiben (Alarmmeldung, Position), liest nichts. Festgehalten als ADR-0015, Ausnahme zu ADR-0014. |
| E2 | Bearer-Lesezugang für Lagemonitore (LLH-1484) | **Vor LGM-14 auf ADR-0014 umstellen.** Der Monitor hält seinen Schlüssel selbst. |
| E3 | Stufe der Benachrichtigung | **Eingang**, nicht Alarm. Ablauf: Ein Alarm kommt herein und erscheint als Alarmmeldung; daraus legt ein Mensch einen neuen Einsatz an (Daten übernommen) oder verknüpft ihn mit einem laufenden. |
| E4 | Nachträge nach der Annahme | **Hinweis am Einsatz** mit „übernehmen“ je Feld, Spur im ETB. |
| E5 | Fristen | Offen → abgelaufen nach 12 h; verworfene/abgelaufene samt Rohdaten nach 7 Tagen löschen; Rohdaten bei Annahme sofort löschen. |
| E6 | Ungekoppelte Instanz | **Eigene Alarmübernahme**; gekoppelte ELW nutzen den Hub. |
| E7 | HiOrg-Einstieg | **EFS-API zuerst** (lesen, API-Key): Veranstaltungen als Vorschläge, Personal-Abgleich. Helferstunden danach über die Core-API (OAuth). |
| E8 | Form im Ausgang | Zuerst **Klartext**; PDF wird mit dem Fax entschieden (Tendenz: Server). |
| E9 | Drohnenvideo | **Kein eigener Medienserver.** Lifeline Hub zeigt WHEP/HLS-Quellen an (Suchlage, MediaMTX des Kunden). |
| E10 | Stammdaten-Eingang | **Eigene Unteraufgabe, Stufe 1.** |
| E11 | Meshtastic | **Weiter verfolgen**, aber zuerst allgemein klären, wie eine Funk-/Mesh-Anbindung als Adapter aussieht. |
| E12 | Verhältnis zu LLH-1148 | **LLH-1148 zuerst** als kurzes Konzept abschließen (ADR-0014 für Fremdsysteme, ADR-0015, `/api/v1`, OpenAPI-Pfade nur für öffentliche Routen). |

Weitere Vorgaben vom 10.11.2026:

- **Copernicus EMS unbedingt anbinden** (LLH-1200), früher als Stufe 3.
- **`@einsatzzeichen` darf** für Export und KMZ-Symbole genutzt werden.
- **Autobahn-API ausbauen.**
- **LLH-Pager** als eigene Idee (unten), noch nicht fest entschieden. Er wird so gebaut, dass er
  nur ein Adapter auf die vorhandenen Verträge ist.

## Alarmübernahme (LLH-1192)

Begriffe: Was hereinkommt, ist eine **Alarmmeldung**. Was ein Mensch sieht, ist ein
**Einsatzvorschlag**. Das Modul heißt **Alarmübernahme**. „Eingang“ ist schon zweimal belegt, als
Benachrichtigungsstufe und durch die Spec `meldungseingang`.

**Normalform** (abgeleitet aus `fireboardOperation` 1.0.3, FE2 Datenformat V2, Divera `/api/v2/alarms`
und BOSWatch 3):

| Feld | Inhalt | Ziel |
| --- | --- | --- |
| `quelle` | aus dem Zugang, nie vom Absender | Herkunft |
| `externe_id` | Schlüssel für Nachträge; fehlt er, führt nur ein Mensch zusammen | Vorschlag |
| `einsatznummer` | Nummer der Leitstelle | `leitstellen_nr` |
| `art` | `neu`, `nachtrag`, `abbruch` oder `abschluss` | Zustand |
| `test` | Probealarm | Probelauf |
| `stichwort` | Einsatzstichwort | `stichwort`, schlägt die Vorlage vor (LLH-1375) |
| `meldung`, `meldebild` | Alarmtext, Lagebeschreibung | `sachverhalt` (je Zugang abschaltbar) |
| `ort` | frei und/oder gegliedert | `einsatzort` |
| `koordinate` | `{system: wgs84\|utm\|gk}` mit benannten Achsen | `einsatzort_lat/lon` |
| `alarmzeit` | ISO 8601 mit Zone | `begonnen_at` |
| `meldender` | Name, Telefon | `meldende_stelle` |
| `einsatzmittel[]` | Rufname, ISSI, OPTA, FMS, RIC | Fahrzeugabgleich, als „alarmiert“ angeboten |
| `zusatz[]` | Bezeichnung + Wert | am Vorschlag |
| `rohdaten` | Original | bei Annahme gelöscht |

**Lebenslauf eines Vorschlags.** Zustände: offen → (Nachtrag) → angenommen | verknüpft |
verworfen | abgelaufen | von der Quelle beendet.

- Duplikate: Der Schlüssel (Zugang, `externe_id`) ist eindeutig. Ohne `externe_id` gibt es nur
  den Hinweis „möglicherweise derselbe Alarm“.
- Antworten: `201` neu, `200` aktualisiert, `401` Zugang ungültig, `422` Inhalt unbrauchbar,
  `413` zu groß.
- Annahme: Der Mensch braucht das Recht „Einsätze anlegen“ und wird Einsatzleitung. Die Org kommt
  aus dem Zugang.
- `anlegen_tx` nimmt dann auch `leitstellen_nr`, `meldende_stelle` und `sachverhalt` an.
- Ins ETB kommen keine geschwärzten Werte im Text.

**Technik.** Die Tabelle `benachrichtigung` verlangt einen Einsatz. Deshalb braucht es ein
Org-Ereignis nach dem Muster `planung` oder einen Umbau der Tabelle; das entscheidet der Entwurf.
Dazu kommt ein Probelauf im Admin-Bereich.

**Erste Adapter:** generische Normalform (POST JSON), BOSWatch 3 (nur GET, Platzhalter in der URL),
Fireboard-Profil (das auch FE2 schon ausgibt; ob die URL einstellbar ist, ist offen), FE2 V2,
Divera (abrufen, Webhook nur als Auslöser), HiOrg-EFS (Veranstaltungen), später Postfach (LLH-1195).

## Gemeinsamer Unterbau (vor den Adaptern)

- **Geheimnisspeicher je Org.** Er hält Divera-Accesskey, IMAP, HiOrg-Token und -Key, SMTP,
  Matrix, Threema und sipgate. Verschlüsselt mit einem Schlüssel aus der Umgebung, nach dem
  Speichern nie wieder angezeigt.
- **Adapter-Rahmen.** Abrufe laufen im Hintergrund mit Backoff, über `http_begrenzt` und ohne
  Weiterleitungen. Je Adapter wird ein Zustand geführt. Ziele im LAN gibt es nur als bewusste
  Ausnahme.
- **Admin-Seite „Anbindungen“.** Hier liegen Zugänge (signiert und Einwurf), Adapter, Profile, der
  Probelauf und die Freigabe durch den Aufgabenträger.
- **Kennung + Herkunft** an Personal, Qualifikation und Fahrzeug, nach dem Muster aus LLH-1556.
- **Koordinatenumrechnung auf dem Server** (UTM/GK → WGS84). Heute gibt es sie nur im Browser.
- **Architektur:** Kapitel 3, 5, 6, 7, 8, 11 und 12 sowie ADR-0015 kommen mit.

## Weitere Wege (Kurzfassung)

- **Stammdaten (neu):**
  - Fahrzeuge (Funkrufname, OPTA, ISSI) und Personal mit Qualifikationen.
  - Erst als Datei mit Vorschau, später als Abruf.
  - Füllt `opta` und `fms_issi` für den Fahrzeugabgleich.
  - Prüfstein ist die iuk-suite (beendet die doppelte Fahrzeugpflege, IDA-306/IDA-299).
- **HiOrg (LLH-1194):**
  - (a) EFS-API lesen;
  - (b) Core-API mit OAuth (nur Authorization Code und Refresh Token) für Helferstunden; die
    Schreibwege sind DRAFT.
  - Die Stunden muss der Server rechnen (Pausen, Spontankräfte, offene Perioden).
  - Nur nötige Felder übernehmen.
- **Ausgang (LLH-1197):**
  - Ausgangskorb nach FwDV 100 (Ein- und Ausgangsnachweisung): Beförderungsvermerk, Weg,
    Gegenstelle, Vorrang.
  - Zustand wartet → übergeben → zugestellt | fehlgeschlagen.
  - Reihenfolge der Kanäle: E-Mail über das Relay des Trägers, Fax und SMS (sipgate), Matrix (der
    BundesMessenger nur bei Föderation), Threema.
  - Externe Stellen bekommen Kontaktwege; `MeldeWeg` wird erweitert.
- **Geodaten (LLH-1196):**
  - Export als GeoJSON mit `lfh:zeichen` und simplestyle-Feldern in BBK-Farben, KMZ mit
    `@einsatzzeichen`-PNGs, GPX für Fireboard.
  - Import als Fremdebene nur lesend; keine DTDs, keinen Links folgen.
  - Fremdebene aus URL (Suchlage).
  - ICS als Einzel-Export in UTC, kein Abo.
- **Personenauskunft (LLH-1198):** kein Spezialformat. CSV mit den Feldern der Karte und
  einstellbaren Spalten, eine Druckliste, nur für die Einsatzleitung, Zustand standardmäßig aus.
- **Ortung (LLH-1199):**
  - OsmAnd-kompatibel über einen Einwurf-Zugang; nur im Einsatz, letzte Position, kein Verlauf.
  - Das BetrVG gilt nicht für Ehrenamtliche (§ 5 Abs. 2 Nr. 3), die DSGVO immer; eine DSFA-Vorlage
    gehört dazu.
  - Erster Prüfstein: FüKw-GPS über den Lagemonitor.
- **Copernicus (LLH-1200):**
  - Aktivierungsliste abrufen; bei einem Treffer im Einsatzgebiet einen Hinweis zeigen und das
    Produkt-GeoJSON als Ebene anbieten.
  - Quellenangabe „© European Union, Copernicus Emergency Management Service“.
  - EFAS ist nicht offen.
- **Drohne (LLH-1202):**
  - Vorher muss der EXIF-Fehler bei Kartenhintergründen behoben sein.
  - Standbild an der Position aus EXIF/XMP; Video als WHEP/HLS-Quelle.
- **Lizenzen (LLH-1203):**
  - NINA: Die Klausel steht im RSS-Feed, nicht im JSON; das Impressum nimmt amtliche
    Warnmeldungen aus. Beim BBK nachfragen.
  - DWD und LHP: CC BY 4.0. PEGELONLINE: DL-DE Zero.
  - Autobahn: Lizenz klären, die Ebene ausbauen.

## LLH-Pager (Idee, offen)

Ein eigener Pager für Lifeline Hub, gedacht für Sanitätsdienste und einzelne Personen auch in
normalen Einsätzen. Beispiel: Eine verletzte Person im Bereitstellungsraum wird mit
Einsatzübertragung an eine Einzelperson gemeldet. GPS-Tracking lässt sich zuschalten.

Ob er wirklich kommt, ist offen. Er wird deshalb **als Adapter auf die vorhandenen Verträge**
gebaut, nicht als eigenes Subsystem:

- **Alarmieren:** Ein Auftrag bzw. ein Einsatzausschnitt geht über den Vertrag „Ausgang“ an eine
  Person. Der Pager ist ein Kanal neben E-Mail und Matrix, mit Quittung („übernommen“).
- **Rückmeldung und Status:** über den Vertrag „Alarmmeldung“ bzw. den Statusweg der Kräfte.
- **GPS:** über den Vertrag „Position“, nur im Einsatz und nur bei aktiver Ortung. Personenortung
  braucht Einwilligung bzw. Dienstvereinbarung und eine DSFA.
- **Endgerät:** Zu klären ist die gekoppelte Geräte-Hülle (`frontend/src/geraet/AGENTS.md`) oder
  eine eigene App. Web Push (LLH-1223) als Zustellweg; ohne Netz geht nichts.

Klärungsaufgabe: Nutzen, Abgrenzung zu Divera/aPager, Zustellweg, Rechtsrahmen der Personenortung.

## Meshtastic, allgemein betrachtet (LLH-1201)

Entscheidung E11c: weiter verfolgen, aber erst klären, wie eine **Funk-/Mesh-Anbindung allgemein**
als Adapter aussieht:

- **Eingang:** Kurzmeldungen werden Meldungen im Meldungseingang, gekennzeichnet „unverifiziert“.
  Positionen gehen in den Vertrag „Position“.
- **Ausgang:** Kurztexte (höchstens 200 Byte) als Kanal im Vertrag „Ausgang“.
- **Ankopplung:**
  - über einen eigenen MQTT-Broker (JSON, nicht auf nRF52) oder eine Brücke, die selbst signiert;
  - Serial/TCP nur über die Brücke, damit die GPL-3.0 der Protobufs nicht in Lifeline Hub wirkt.
- **Grenzen:**
  - Der Kanal-PSK ist nicht authentisiert, Absender sind fälschbar.
  - Durchsatz etwa 1 kbit/s, 10 % Duty-Cycle.
  - Kein Führungsfunk.
- Dasselbe Muster soll für MeshCore oder Reticulum tragen.

## Fund nebenbei

Hintergrundbilder der Lagekarte werden ohne EXIF-Bereinigung ausgeliefert
(`src/routes/karte_hintergrundbild.rs:124-165`). Ein Drohnenfoto gäbe so seine GPS-Daten preis.

## Offene Punkte (nur extern klärbar)

- **HiOrg:** Laufen `sethelferstunden` und die Scopes `personal:read` und `helferstunden:add`?
  Darf eine Org zwei Clients haben?
- **alamos:** Ist die URL des Fireboard-Ausgangs einstellbar? Bleibt die `alarmId` bei Nachträgen
  gleich?
- **Fireboard:** Duldet es ein kompatibles Profil?
- **Divera:** Wie sieht der Inhalt des Webhooks aus, und lösen Nachträge ihn aus?
- **MI RLP:** Spezifikation MAÜ 1.1.
- **LZPD NRW und DRK-Suchdienst:** CSV-Vorlage für GSL.net, Importweg für Xenios.
- **BBK:** NINA-Weiterverwendung, Lizenz der Zeichendateien.
- **BWI und THW:** Föderation bzw. Bots.
- **Jurist:** § 5 TDDDG, CRA, Ortung von Hauptamtlichen.

## Schnitt

Angelegt am 10.11.2026: LLH-1632 Adapter-Rahmen, LLH-1633 Stammdaten-Eingang, LLH-1634 HiOrg EFS-API, LLH-1635 EXIF-Fehler (Bug), LLH-1636 LLH-Pager klären, LLH-1637 Autobahn ausbauen, LLH-1638 Lagemonitor-Zugang nach ADR-0014 (unter LLH-1148). Die tragenden Teile
laufen über die Route `entwurf` mit je einer OpenSpec-Change. Reihenfolge:

1. LLH-1148 abschließen.
2. EXIF-Fehler beheben.
3. Adapter-Rahmen mit Geheimnisspeicher bauen.
4. Danach LLH-1192, den Stammdaten-Eingang, Divera und HiOrg-EFS.
5. Copernicus früh, weil klein und ausdrücklich gewünscht.
6. Dann Ausgang, Postfach, Geodaten und Personenauskunft.
7. Zuletzt Ortung, Drohne, Pager und Funk-/Mesh-Anbindung.
