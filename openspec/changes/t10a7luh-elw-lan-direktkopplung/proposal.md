# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/t10a7luhp4fctv9l8y4maeds (LLH-1497, Epic LLH-1287)

## Why

Zwei ELW am selben Schadensort haben oft kein Internet, sollen sich aber gegenseitig lesen und
Anträge stellen können: Der Nicht-Führer liest beim führenden ELW mit und beantragt dort
Erfassungen (Entscheidung 13 im Konzept `docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`).
Das Protokoll kennt seit LLH-1490 nur Richtung, nicht Hub und ELW. Für zwei ELW im LAN fehlt
aber Folgendes:

- **Finden:** Die Gegenstelle lässt sich nicht finden, die Adresse muss man von Hand eintippen.
- **Verschlüsseln:** Die Kopplung verlangt ein Zertifikat, dem das Betriebssystem vertraut. Das
  selbstsignierte Zertifikat eines ELW fällt durch.
- **Rolle der erreichten Seite:** Sie verhält sich wie ein Hub. Sie nimmt Epochen ohne Beweis
  an, bekommt die Verwahrung, gilt als verteilend (Passkey-Pflicht) und kann zur
  Stammdatenquelle werden.
- **Konten:** Ein Antrag scheitert mit „Konto am Führer unbekannt“, obwohl beide ELW das Konto
  vom selben Hub haben.

Die Teile Kopplung, Führung und Spiegel sind fertig (LLH-1490/1491/1492). Damit ist das jetzt
der erste Schritt zur P2P-Linie der Native-Apps-Roadmap.

## What Changes

- **Direktkopplung vor Ort.** Eine Kopplung trägt eine Art: `standard` oder `vor_ort`. Die Art
  wählt der Admin beim Ausstellen des Codes. Sie ist ein Merkmal der Kopplung, nicht der
  Instanz, und Hub und ELW unterscheidet das Protokoll weiter nicht.
  - **Was fließt:** nur Führungsakten zur Anzeige, Spiegel und Anträge.
  - **Was gesperrt ist:** Übergabe, Übernahme auf Anfrage, Notübernahme, Verwahrung,
    Stammdaten-Verteilung und Geheimnisse.
  - **Keine Passkey-Pflicht:** Eine Direktkopplung macht die Org nicht „verteilend“.
  - **Kein „ELW verloren“:** Ohne gelieferte Geheimnisse gibt es auf einer Direktkopplung
    nichts zu entwerten.
- **Zertifikat durch signierte Aussage beglaubigt.** Auf einer Direktkopplung zählt nicht das
  Vertrauen des Betriebssystems ins TLS-Zertifikat. Es zählt eine Aussage der Gegenstelle, die
  sie mit ihrem Instanzschlüssel signiert: „Ich zeige das Zertifikat mit diesem Fingerabdruck.“
  - Die einlösende Seite prüft diese Aussage beim Koppeln und pinnt das Zertifikat.
  - Zeigt die Gegenstelle später ein anderes Zertifikat (neues rcgen-Zertifikat nach IP-Wechsel,
    neues mkcert), holt die meldende Seite zuerst eine signierte Aussage ohne Nutzlast ein.
    Erst dann schickt sie Einsatzdaten.
  - Selbstsignierte Zertifikate funktionieren so. Ein Angreifer in der Mitte fällt auf.
- **Entdeckung im LAN (mDNS/DNS-SD).** Mit dem neuen Schalter `--lan-entdeckung`
  (`LIFELINE_LAN_ENTDECKUNG`, Vorgabe aus, nur zusammen mit `--tls`) kündigt sich die Instanz
  als `_lifeline-hub._tcp` an. Die Ankündigung trägt Kennung, Name, Fingerabdruck und
  Protokollversion.
  - Der Dialog „Code einlösen“ zeigt eine Liste „Im Netz gefunden“.
  - Ändert sich die Adresse der Gegenstelle (DHCP), sucht eine Direktkopplung sie per Kennung
    neu.
  - Vertrauen entsteht nie über die Ankündigung, nur über Code, Prüfwert und signierte Aussage.
  - Ohne Schalter sendet die Instanz keinerlei Multicast.
- **Gemeinsame Herkunft von Konten und Stammdaten.** Jede Stammdatenzeile hat eine
  instanzübergreifende Ursprungskennung `<instanzkennung>/<schlüssel>` der Instanz, die sie
  angelegt hat. Die Stammdaten-Lieferung trägt sie mit, `stammdaten_herkunft` speichert sie.
  - Spiegelzeilen und Anträge nennen zu jedem Verweis auf Stammdaten und Konten die
    Ursprungskennung.
  - Die Empfängerseite bildet sie auf ihre eigene Zeile ab, auch ohne Stammdatenfluss auf
    dieser Kopplung.
  - Ergebnis: Zwei ELW, die beide vom selben Hub beliefert werden, erkennen Konten, Fahrzeuge,
    Personal, Material, Status und Typen der anderen Seite als dieselben. Anträge laufen durch,
    und Rollen und Verweise im Spiegel stimmen.
- **Protokoll 3.** Neue Felder für Art, beglaubigtes Zertifikat und Ursprungskennungen. Eine
  Direktkopplung verlangt Protokoll 3 an beiden Seiten. Standardkopplungen mit Protokoll 2
  arbeiten weiter (N/N−1).
- **Oberfläche auf der Seite „Instanzkopplung“:**
  - Beim Ausstellen die Wahl „Direktkopplung vor Ort“.
  - Beim Einlösen die Liste „Im Netz gefunden“.
  - Je Kopplung der Chip „vor Ort“ und der Zustand des Zertifikats.
  - Das Paneel „Führung“ bietet für eine Gegenstelle vor Ort keinen Wechsel an und sagt warum.

## Capabilities

### New Capabilities

- `instanz-entdeckung`: Ankündigen und Finden von Lifeline-Hub-Instanzen im lokalen Netz per
  mDNS/DNS-SD, Schalter und Grenzen, Neuauflösen der Adresse einer Direktkopplung.

### Modified Capabilities

- `instanz-kopplung`: Art der Kopplung (Direktkopplung vor Ort) und durch signierte Aussage
  beglaubigtes TLS-Zertifikat. Dazu Protokoll 3.
- `instanz-fuehrung`: Über eine Direktkopplung wechselt die Führung nicht, es gibt keine
  Verwahrung, und eine Abgabe des Führers an eine Dritte wird dort angenommen.
- `einsatz-spiegel`: Verweise auf Konten und Stammdaten werden über die Ursprungskennung
  abgebildet.
- `spiegel-antraege`: Das Konto eines Antrags wird über die Ursprungskennung erkannt.
- `stammdaten-verteilung`: Ursprungskennung je Zeile. Eine Direktkopplung liefert keine
  Stammdaten und macht die Org weder zur Quelle noch zu einer verteilenden Org.

## Impact

- **Backend:**
  - `src/instanz/` (`mod.rs` mit Protokoll 3, `repo.rs`, `melden.rs`, `code.rs`,
    `ausgehend.rs`)
  - Neues Modul `src/instanz/entdeckung.rs`, neues Modul für das beglaubigte Zertifikat
  - `fuehrung/austausch.rs`, `fuehrung/repo.rs`, `fuehrung/dienst.rs`
  - `spiegel/abbildung.rs`, `liefern.rs`, `uebernehmen.rs`, `antrag.rs`, `katalog.rs`,
    `lebensende.rs`
  - `stammdaten/{liefern,uebernehmen,herkunft,geheimnis}.rs`
  - `src/routes/instanz.rs`, `src/config.rs`, `src/tls/mod.rs` (Fingerabdruck des eigenen
    Zertifikats), `src/main.rs`
- **Datenbank:** neue Migration (nach 0328) mit `instanz_kopplung.art`,
  `instanz_kopplung.tls_spki`, `instanz_kopplungscode.art`, `stammdaten_herkunft.ursprung`
  samt Index und Backfill.
- **API und Typ-Codegen:** Antworten der Instanzkopplung bekommen Art, Zertifikatszustand und
  die Liste der gefundenen Instanzen (`GET /api/admin/instanz/lan`). Die generierten Typen
  werden neu erzeugt.
- **Frontend:** `frontend/src/instanz/` (`InstanzkopplungSeite.tsx`, `instanzText.ts`,
  `FuehrungPaneel.tsx`, `api/instanz.ts`).
- **Abhängigkeit:** neue Crate `mdns-sd` (reines Rust, MIT/Apache-2.0). Der Advisory-Check
  läuft über `scripts/check-deps.sh`.
- **Doku:**
  - `docs/architektur/07-verteilungssicht.md` (der Satz „stellt sich nicht per mDNS vor“ wird
    ersetzt), `05-bausteinsicht.md`, `08`/`11`, wo betroffen
  - Neue ADR zum beglaubigten Zertifikat
  - `docs/betrieb/packaging.md` und `docs/betrieb-tls.md`
  - `docs/anwender/kapitel/instanzkopplung.md`
  - Konzeptnotiz: die offene Frage „Entdeckung im LAN“ wird beantwortet
- **Nicht in dieser Change:**
  - Führungswechsel zwischen zwei ELW (LLH-1678)
  - Beglaubigtes Zertifikat hinter einem Reverse-Proxy
  - Weiterleiten über mehrere Instanzen (Relay)
  - Ankündigung über andere Wege als mDNS
