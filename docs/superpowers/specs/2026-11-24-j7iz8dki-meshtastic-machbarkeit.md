# Meshtastic/LoRa als Rückfallweg bei Netzausfall — Machbarkeit

Zunder: https://zunder.rubeen.dev/#/aufgabe/j7iz8dkiy0qgkon2d5u4zkxr (LLH-1201, unter LLH-1191) ·
Stand 24.11.2026 · Machbarkeitsnotiz, kein Code

## Fazit

**Machbar und weiter zu verfolgen, aber nur als Brücke.** Die Brücke ist ein eigenes, kleines
Programm neben dem Server. Sie spricht mit einem Funkknoten über USB, TCP oder BLE, übersetzt
dessen Pakete in die vorhandenen Verträge und meldet sich am Server signiert an, wie jede
Maschine (ADR-0034). Den Weg über MQTT mit JSON, den die Aufgabe noch voraussetzt, gibt es nicht
mehr: Meshtastic hat JSON über MQTT mit Firmware 2.8 auf allen Plattformen entfernt (s. „Technik“).

**Jetzt nichts bauen.** Die Brücke ist ein dünner Adapter auf drei Verträge, von denen zwei noch
nicht fertig sind: Positionen erscheinen noch nicht im Einsatz (LLH-1199), und den Ausgang gibt es
noch nicht (LLH-1197). Die Umsetzung kommt nach beiden, wie der Schnitt des Schnittstellen-Ausbaus
es vorsieht („zuletzt Funk-/Mesh-Anbindung“, `docs/konzepte/2026-11-10-schnittstellen-ausbau.md`).

Meshtastic ist **kein Führungsfunk** und ersetzt keinen BOS-Funk. Es ist ein zusätzlicher,
unsicherer Meldeweg für Kurztext und Position. Alles, was darüber hereinkommt, ist unverifiziert,
bis ein Mensch es bestätigt (G1).

## Ausgangslage im Code

| Vertrag | Stand | Was Meshtastic bräuchte |
| --- | --- | --- |
| Position (herein) | Einwurf-Zugang mit Scope `positionen:write` nimmt Positionen an, je Kennung die letzte, ohne Verlauf, 24 h (`src/public_api/einwurf/ablage.rs`, ADR-0023) | nichts Neues; die Anzeige im Einsatz kommt mit LLH-1199 |
| Meldung (herein) | Meldungseingang gibt es nur für Menschen (`src/meldung/`, Spec `meldungseingang`); kein Maschinen-Eingang, kein Merkmal „unverifiziert“ | neuer Scope (Arbeitstitel `meldungen:write`), Ablage als Vorschlag, Merkmal „unverifiziert“, Meldeweg `funk` bzw. neuer Wert |
| Ausgang (hinaus) | in Arbeit (LLH-1197): Ausgangskorb, Zustände wartet → übergeben → zugestellt \| fehlgeschlagen | Kanal „Mesh“ mit Grenze 200 Byte; die Brücke holt ab und quittiert |
| Anmeldung | Maschinen mit Ed25519 und signierten Anfragen (ADR-0034), Einwurf nur über TLS (ADR-0023) | die Brücke signiert, also kein Einwurf-Zugang nötig |

Im Blackout läuft der ELW ungekoppelt. Er verhält sich dann wie ein Hub (G5, E6), deshalb spricht
die Brücke immer mit dem Server, der vor Ort läuft, im ELW also mit dem ELW-Server.

## Technik

### Ankopplung: Brücke statt MQTT-Client im Server

- **JSON über MQTT ist weg.** Firmware-PR #10152 (gemergt 03.06.2026) entfernt die JSON-Topics für
  Uplink und Downlink. Das Feld `json_enabled` wird ignoriert (protobufs PR #890). Über MQTT kommt
  nur noch der Protobuf-`ServiceEnvelope`. Vorher war JSON schon auf nRF52 nicht verfügbar.
- **Die Protobufs, die Firmware und die Python-Bibliothek stehen unter GPL-3.0.** Lifeline Hub hat
  keine Open-Source-Lizenz (`LICENSE`). Wer die Protobufs in den Server einbaut, holt sich die GPL
  in den Server. Eine eigenständige Brücke als eigener Prozess unter GPL-3.0 trennt das sauber.
  Sie redet mit dem Server nur über `/api/v1`. Eine offizielle Aussage von Meshtastic dazu gibt es
  nicht, und das ist keine Rechtsauskunft (offene Frage J1).
- **Die Brücke trägt die Herstellerdetails** (G4). Der Kern kennt nur „Mesh-Gerät mit Kennung“,
  Kurztext und Position. Dasselbe Muster trägt MeshCore (MIT, Companion-Protokoll über USB und
  BLE) und Reticulum/LXMF (über RNode). Die Lizenz von Reticulum verbietet Systeme, die Menschen
  schaden können; für Katastrophenschutz unkritisch, aber vor einem Reticulum-Adapter lesen.
- **Ein eigener MQTT-Broker bleibt möglich, aber nur als Quelle der Brücke.** Die Brücke abonniert
  ihn statt eines USB-Knotens, wenn mehrere Gateways im Gelände stehen. Der Server bekommt keinen
  MQTT-Client und keinen Broker im ELW-Stack.

### Sicherheit

- **Ein Kanal-PSK beweist nichts über den Absender.** AES-CTR ohne Authentisierung: Wer den
  Schlüssel hat, kann als jeder andere Knoten des Kanals senden.
- **Ab Firmware 2.8 gibt es Abhilfe, aber nur wahlweise:** Broadcasts mit XEdDSA-Signatur
  (66 Byte), Kanäle mit AES-CCM („Use AEAD“, alle Knoten müssen es einschalten), Knoten-IDs aus
  dem öffentlichen Schlüssel. Die Standardrichtlinie nimmt unsignierte Pakete weiter an. 2.8 ist
  noch Alpha (2.8.2 vom 04.11.2026), stabil ist 2.7.
- **Direktnachrichten mit PKC** (X25519 + AES-CCM, seit 2.5) sind authentisiert.
- **Daraus folgt für Lifeline Hub:** Jede Meldung über Mesh bleibt unverifiziert. Die Brücke
  reicht mit, ob ein Paket signiert war und ob der Schlüssel des Knotens bekannt ist. Die Anzeige
  zeigt das, ein Mensch bestätigt. Positionen fremder oder unbekannter Knoten nimmt die Brücke
  nicht an, nur die von Knoten, die ein Admin in der Brücke hinterlegt hat.
- **Bekannte Lücken:** CVE-2025-52464 (doppelte Schlüssel ab Werk, bis 2.6.11), CVE-2025-53627
  (gefälschte PKI-Direktnachrichten, bis 2.7.15). Knoten brauchen also eine Mindestversion.

### Durchsatz und Reichweite

- **Band:** EU_868 nutzt 869,4–869,65 MHz mit 27 dBm (≈ 500 mW) und 10 % Duty-Cycle; am
  Stundenlimit sendet der Knoten nicht mehr.
- **Nutzlast:** höchstens 233 Byte je Paket, mit Signatur 66 weniger. Kurztexte also höchstens
  etwa 160 Byte, wenn sie signiert sein sollen, sonst 200.
- **Rate:** LongFast etwa 1 kbit/s, MediumFast etwa 3,5 kbit/s (Sekundärquelle). Standardmäßig 3
  Hops, höchstens 7. Ab 40 % Kanalauslastung sendet die Firmware nicht mehr.
- **Reichweite:** in bebautem Gebiet wenige Kilometer (2–5 km, informell), mit Sichtverbindung
  weit mehr. Belastbare Messungen fehlen. Eine Übung des DARC (Köln/Aachen, 21.02.2026) brachte
  Nachrichten von 7 der 8 Standorte hin und zurück, das Routing schwächelte.
- **Für den Entwurf heißt das:** kein Datenstrom, keine Bilder, keine Lagekarte. Positionen
  höchstens alle paar Minuten je Knoten, sonst frisst der Duty-Cycle die Kurzmeldungen. Ausgang nur
  Klartext, ein Paket je Nachricht, kein Zerlegen.

## Recht und Organisation

- **Frequenz:** 869,4–869,65 MHz ist für Geräte mit kurzer Reichweite allgemein zugeteilt,
  anmeldefrei (laut Bundesnetzagentur jetzt Vfg. 91/2025; die Zeile im Text der Verfügung ist noch
  nicht geprüft). Es ist **kein BOS-Funk** und hat keinen Vorrang.
- **BOS:** Die BOS-Funkrichtlinie 2024 regelt die BOS-Frequenzen. Eine Aussage, ob BOS
  Nicht-BOS-Funk ergänzend nutzen dürfen, fehlt. Da Meshtastic hier nur einen zusätzlichen
  Meldeweg liefert, der nicht als Führungsfunk gilt, sehe ich kein Verbot. Klären muss es aber der
  Aufgabenträger (offene Frage J2).
- **Erfahrungen:** Bisher keine BOS-Erfahrung in Serie. Bekannt sind:
  - der Katastrophenschutz-Leuchtturm Mellensee (Landkreis Teltow-Fläming, seit 09.04.2025, mit
    Heltec-V3-Knoten für Verwaltungsstab und Feuerwehr, Übung 09/2025 mit THW); die Quelle ist nur
    der Bericht des beteiligten Anbieters;
  - eine Kleine Anfrage im Landtag Rheinland-Pfalz vom 07.05.2026 zu kommunalen Piloten, ohne
    gefundene Antwort;
  - Notfunk-Gruppen des DARC und die Donnersberg Relais-Gruppe (Meshtastic und MeshCore).
- **Wer stellt die Knoten?** Die Org selbst, als Ausstattung wie Handfunkgeräte: ein Gateway-Knoten
  am ELW (am USB des Servers oder als Netzknoten), je Abschnitt ein Knoten, dazu Relais auf Höhen.
  Ein öffentliches Mesh oder den öffentlichen Broker nutzt Lifeline Hub nicht.
- **Datenschutz:** wie bei der Fahrzeugortung (LLH-1199). DSGVO gilt, Rechtsgrundlage im Landes-
  Brand- bzw. KatS-Gesetz, Folgenabschätzung mit Vorlage; Positionen nur im Einsatz, nur die
  letzte, kein Verlauf (ADR-0023). Positionen reisen nur über einen privaten Kanal, nie über einen
  mit bekanntem Schlüssel (ab 2.8 ohnehin nur ungenau).

## Ablauf, wie er später aussähe

1. Ein Admin richtet die Brücke als Maschinenzugang ein (Einmal-Code, ADR-0034) und hinterlegt
   in ihr die eigenen Knoten mit Kennung, Rufname und Schlüssel.
2. Ein Abschnittsführer tippt am Handy (Meshtastic-App über BLE am Knoten) „Abschnitt Nord: 2
   Verletzte, brauchen RTW“. Die Brücke empfängt es über den Gateway-Knoten.
3. Die Meldung erscheint im Meldungseingang des laufenden Einsatzes als Vorschlag mit Kennzeichen
   „unverifiziert · Mesh · Knoten ‚Nord-1‘ · signiert ja/nein“. Ein Mensch übernimmt sie als
   Meldung (Meldeweg Funk) oder verwirft sie. Erst dann steht sie im ETB.
4. Positionen der eigenen Knoten landen in der Ablage für Positionen und erscheinen nach LLH-1199
   an der zugeordneten Einheit.
5. Antwortet die Einsatzleitung über den Ausgang mit Kanal „Mesh“, holt die Brücke die Nachricht
   ab, sendet sie als Direktnachricht an den Knoten und quittiert „übergeben“. „Zugestellt“ gilt
   erst mit der Bestätigung des Empfängerknotens.

## Empfehlung

**Umsetzen, aber nach LLH-1199 und LLH-1197**, in drei Schritten:

1. **Maschinen-Eingang für Meldungen** (Route `entwurf`, E2: neuer Scope und Merkmal
   „unverifiziert“). Nützt nicht nur Mesh, sondern jedem Adapter, der Text liefert (Postfach
   LLH-1195, Pager).
2. **Mesh-Brücke** als eigenes Repository unter GPL-3.0: Meshtastic über USB/TCP zuerst, signierte
   Anfragen an `/api/v1`, Positionen und Meldungen. Probelauf mit zwei Knoten auf dem Tisch.
3. **Kanal „Mesh“ im Ausgang**, sobald LLH-1197 steht.

Verwerfen würde ich es nicht: Die Knoten kosten wenig, der Weg nutzt vorhandene Verträge, und im
Blackout ist er der einzige Datenweg außer dem Melder zu Fuß. Ein Pilot mit Hardware lohnt aber
erst, wenn eine Org Knoten stellen will.

**Entscheidung des Menschen (24.11.2026):** Empfehlung angenommen, umgesetzt wird später. Die
drei Schritte sind angelegt: LLH-2112 (Maschinen-Eingang für Meldungen), LLH-2113 (Mesh-Brücke,
wartet auf LLH-2112) und LLH-2114 (Kanal „Mesh“, wartet auf LLH-1197 und LLH-2113).

## Offene Fragen

- **J1 Lizenz:** Darf die Brücke als GPL-Programm neben dem proprietären Server ausgeliefert werden
  (im selben Image, auf demselben Gerät)? Jurist, gemeinsam mit den Fragen aus dem
  Schnittstellen-Ausbau.
- **J2 BOS:** Erlaubt der Aufgabenträger einen Nicht-BOS-Meldeweg als Ergänzung? Beim ersten
  Pilotkunden klären.
- **J3 Firmware:** Mindestversion 2.7.15; Signaturen und AEAD erst, wenn 2.8 stabil ist. Bis dahin
  bleibt jede Mesh-Meldung ohne Absendernachweis.

## Quellen

- Firmware-PR #10152 (JSON entfernt): https://github.com/meshtastic/firmware/pull/10152
- protobufs-PR #890 (`json_enabled` veraltet): https://github.com/meshtastic/protobufs/pull/890
- Verschlüsselung und Grenzen: https://github.com/meshtastic/meshtastic/tree/master/docs/about/overview/encryption
- MQTT-Modul: https://github.com/meshtastic/meshtastic/blob/master/docs/configuration/module/mqtt.mdx
- Region EU_868: https://github.com/meshtastic/firmware/blob/develop/src/mesh/RadioInterface.cpp
- Nutzlast: https://github.com/meshtastic/protobufs/blob/master/meshtastic/mesh.options
- Kanalauslastung: https://github.com/meshtastic/firmware/blob/develop/src/airtime.h
- Sicherheitshinweise: https://github.com/meshtastic/firmware/security/advisories
- Releases 2.7/2.8: https://github.com/meshtastic/firmware/releases
- Bundesnetzagentur, Allgemeinzuteilungen: https://www.bundesnetzagentur.de/allgemeinzuteilungen
- BOS-Funkrichtlinie 2024: https://www.lfs-bw.de/fileadmin/LFS-BW/themen/technik/funk/allgemein/dokumente/Funkrichtlinie_Funkanwendungen_BOS_2024.pdf
- Katastrophenschutz-Leuchtturm Mellensee: https://tjk-solutions.de/archive/935,
  https://www.teltow-flaeming.de/aktuelles-details/hilfe-im-ernstfall
- Landtag RLP, Drucksache 18/14497: https://dokumente.landtag.rlp.de/landtag/drucksachen/14497-18.pdf
- DARC-Notfunkübung Köln/Aachen: https://www.darc.de/der-club/distrikte/g/ortsverbaende/11/nachrichten-details/news/stark-im-verbund-notfunkuebung-in-koeln-aachen/
- Datenschutz bei Alarmierungssystemen (Brandenburg): https://mik.brandenburg.de/sixcms/media.php/9/Hinweise%20zum%20Datenschutz%20beim%20Betrieb%20von%20Alarmierungssystemen%20im%20Land%20Brandenburg.pdf
- MeshCore: https://github.com/meshcore-dev/MeshCore · Reticulum: https://github.com/markqvist/Reticulum
