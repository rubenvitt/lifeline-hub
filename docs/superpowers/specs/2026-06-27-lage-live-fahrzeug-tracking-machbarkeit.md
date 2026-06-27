# L‑4 — Live-Fahrzeug-Tracking auf der Lagekarte — Machbarkeit & Entscheidung (LFH‑24)

**Status:** entschieden (kein Code) · **Datum:** 2026-06-27 · **Board:** LFH‑24 (geparktes L‑4 der Lage-Sequenz, Teilprojekt 4 „Lage")

## Fazit (BLUF)

**Live-Fahrzeug-Tracking ist im self-hosted/offline-ELW machbar — aber nur über Positionen, die das
Fahrzeug-/Besatzungsgerät an einen lokalen Ingest-Endpoint *pusht* (Besatzungs-App > GPS-Tracker),
nicht über das Anzapfen von TETRA/FMS-Digitalfunk oder Leitstellen-AVL.** Empfehlung:
**Idee nicht verwerfen, aber jetzt keine Umsetzungs-Spec.** L‑4 bleibt geparkt; dieses Dokument
fixiert Machbarkeit, Ziel-Architektur (generischer Positions-Ingest in den **bereits vorhandenen**
`einsatz_fahrzeug.lat/lon`-Slot) und die Datenschutz-Leitplanken. **Technisch ist die App-Quelle
schon heute off-the-shelf machbar** (nativer Traccar-Client → lokale Box); das einzige *bindende*
Gate ist die **Mitbestimmung**. Eine schlanke Umsetzungs-Spec entsteht erst, **wenn (a) die
Mitbestimmung (Betriebs-/Dienstvereinbarung) geklärt ist und (b) ein produktreifer Quellpfad
ansteht** — die eigene Besatzungs-App (Tauri-2-Roadmap) oder bewusst der Off-the-shelf-Interim.

## Ausgangslage — die halbe Miete steht schon

L‑2 (taktische Gliederung) rendert disponierte Fahrzeuge bereits als **DV‑102-Zeichen mit
FMS-Status-Badge**, **manuell** platziert (`einsatz_fahrzeug.lat/lon` via
`PATCH …/fahrzeuge/{ef_id}/position`, ohne ETB-Spur) und **live über SSE** (`fahrzeug`-Stream,
`LiveHub`). Damit ist die gesamte Downstream-Maschinerie (Koordinaten-Slot, Marker-Rendering,
Live-Verteilung, Status-Ring) vorhanden. **L‑4 ist deshalb kein neues Subsystem, sondern nur eine
*automatische Quelle* für einen vorhandenen Slot** — der Integrationsaufwand auf unserer Seite ist
gering; das gesamte Machbarkeitsrisiko liegt auf der **Beschaffung der Positionsquelle** im
offline/self-hosted Kontext (L‑1: „lokal im ELW, ggf. ganz ohne Netz"). „Manuelle Pflege" aus der
Aufgabenstellung ist damit bereits Status quo — die offene Frage ist ausschließlich die
*Automatisierung*.

## Bewertete Optionen (gewichtete Matrix)

Quellen für eine **automatische** Position; A = Status quo als Referenz-Messlatte. Score 1–5 × Gewicht (Σ100), max 500.

| Faktor (Gewicht) | A: Manuell (Status quo) | B: Besatzungs-/Smartphone-App | C: GPS-Tracker-HW + Traccar | D: TETRA/FMS-Digitalfunk |
|---|---|---|---|---|
| Offline-/Self-Host-Tauglichkeit ohne Leitstelle/Netzbetreiber (30) | **5** | 4 | 3 | 1 |
| Beschaffbarkeit der Quelle / offene Schnittstelle (25) | **5** | 4 | 4 | 1 |
| Datenschutz/Mitbestimmung tragbar (20) | **5** | 3 | 3 | 2 |
| Aufwand vs. Nutzen (Integration + HW/Logistik + Betrieb) (15) | 3 | 4 | 3 | 1 |
| Genauigkeit / Aktualität / Robustheit (10) | 2 | 4 | 4 | 3 |
| **Score (×Gewicht, max 500)** | **440** | **380** | **335** | **140** |

**Lesart.** Der harte Filter „offline/self-hosted, ohne Leitstellen-/Netzbetreiber-Gateway"
eliminiert **D** deutlich und zieht **C-via-Leitstellen-AVL** ins Aus; übrig bleibt das offene
**Push-Muster** (App/Tracker → lokale Box). Dass **A (manuell)** vorne liegt, ist die ehrliche
Pointe: Automatik schlägt den Status quo erst, wenn sie offline + rechtlich + beschaffbar
sauber ist — sie ist **kein Selbstläufer**, sondern lohnt nur unter Bedingungen. Unter den
automatischen Quellen führt **B** (passt auf Stack + Roadmap) vor **C** (Hardware-Logistik).

**Sensitivität:** Streicht man den Top-Faktor (Offline, 30) ganz, bleibt die Reihung stabil
(A 290 > B 260 > C 245 > D 110). D bleibt unter allen plausiblen Gewichtungen abgeschlagen.

## Befunde je Quelle (Recherche, adversarial verifiziert)

- **D — TETRA/FMS-Digitalfunk: nicht beziehbar für eine offline-Box.** GPS *fließt* im BOS-Funk
  (TETRA-SDS/LIP transportiert Positionen; auch FMS kann via Folgetelegramm GPS tragen — die
  Annahme „FMS überträgt *nur* Status" ist falsch). Aber: das BOS-Netz ist **verschlüsselt**
  (TETRA-Luftschnittstelle + optional E2E), zentral über **NEM/BDBOS** verwaltet, und die einzige
  *lokal* zulässige Auswertung (ortsfestes FRT + PEI-Schnittstelle an einen PC) ist ausdrücklich
  **auf die bereichs-/organisationsbezogene Statusgruppe beschränkt — die GPS-Gruppe und die
  landesweite Statusgruppe sind gesperrt** (nur Integrierte Leitstellen). Genau die für Tracking
  nötige Quelle ist also regulatorisch verboten; ein FRT muss zudem bei der BDBOS angemeldet werden.
- **C-Variante Leitstellen-AVL: existiert, aber nicht offline/eigenständig.** Position liegt in
  ELS (iSE COBRA 4/WDX‑3, CKS CELIOS 7) und ist über dokumentierte Schnittstellen exportierbar
  (DIVERA, FeuerSoftware) — aber **vendor- und Bundesland-spezifisch**, **einsatz-scoped**
  (außerhalb eines aktiven Einsatzes keine Weitergabe), teils nur per E-Mail/XML-Mailbox, **kein
  offener DE-weiter AVL-Standard** (DIN SPEC 91287/REST existiert, läuft aber über die Leitstelle).
  Setzt eine Leitstellen-Anbindung voraus → widerspricht „self-hosted/offline".
- **C — GPS-Tracker + self-hosted Server: technisch offline machbar.** **Traccar** (Open Source,
  Java, seit 2012) ist self-hostbar auf einem Raspberry Pi/Docker, versteht 200+ Protokolle/2000+
  Geräte und läuft **vollständig offline im LAN** (belegt: Pi als WLAN-Hotspot/Captive-Portal, kein
  Internet). Günstige LTE/2G-Tracker im niedrigen zweistelligen €-Bereich (z. B. ~45 €); für echtes Off-Grid **LoRa/Meshtastic** (kein
  SIM/Cloud, DIY-Kit < 30 $, Update-Rate/Bandbreite gering). Push über das simple **OsmAnd-Protokoll
  (HTTP, Port 5055, lat/lon/deviceid)**. Preis: Hardware-Beschaffung, Einbau und Flotten-Logistik je
  Fahrzeug; LTE-Tracker brauchen Mobilfunk, um die Box zu erreichen.
- **B — Besatzungs-/Smartphone-App: bester Stack-Fit, schon heute machbar.** Ein Telefon pusht
  seine Position über das offene OsmAnd-Muster an die lokale Box über WLAN/Mesh — ohne Internet,
  ohne Leitstelle. Das geht **off-the-shelf bereits mit dem nativen Traccar-Client (iOS/Android)
  → lokale Box** (belegt); eine eigene App auf der **Native-Apps-Roadmap** (Tauri 2, offline-first,
  später P2P) wäre nur die produktreife, integrierte Variante. Caveats: echte iOS-Hintergrund-Ortung
  braucht eine **native** App (Traccar-Client oder eigene Tauri-App), nicht die reine PWA;
  Akku/Funkabdeckung.

## Datenschutz / Mitbestimmung — das eigentliche Gate (nicht-technisch)

- **Zwingende Mitbestimmung:** GPS-Ortung von Beschäftigten ist nach **§ 87 Abs. 1 Nr. 6 BetrVG**
  mitbestimmungspflichtig (Verhaltens-/Leistungsüberwachung) — ohne Beteiligung des
  Betriebs-/Personalrats **nicht rechtmäßig einführbar**. Eine **Betriebs-/Dienstvereinbarung** ist
  zugleich die taugliche **Rechtsgrundlage** (Mitbestimmung = Hürde *und* Weg). Bloße Einwilligung
  trägt eine Dauerortung mitgeführter Geräte gerade **nicht**.
- **Verhältnismäßigkeit:** 24/7-**Dauerortung** ist unzulässig; nur **einsatzbezogene**, befristete
  Ortung ist tragfähig. **Live-Anzeige** ist zulässig — die **Dauerprotokollierung** der Positionen
  ist es für viele Zwecke nicht (VG Wiesbaden). Das deckt sich glücklich mit dem **vorhandenen
  Datenmodell**: `einsatz_fahrzeug.lat/lon` hält **nur den aktuellen Wert, keine Positions-Historie**
  — „live ohne Logbuch" ist also der Default, nicht ein Nachrüst-Feature.

## Entscheidung

1. **L‑4 wird NICHT verworfen.** Machbarkeit: **geht — unter Bedingungen** (s. Fazit).
2. **Jetzt keine Umsetzungs-Spec — aber kein Machbarkeits-Gate offen.** Die App-Quelle ist
   **heute** off-the-shelf machbar (nativer Traccar-Client → lokale Box über WLAN, offline); die
   eigene Tauri-Mobile-App ist **Produktreife/UX**, kein Machbarkeitshindernis. Das einzige
   *bindende* Gate ist die **Mitbestimmung**. Jetzt voll bauen wäre verfrüht (kein produktreifer
   Quellpfad, Recht ungeklärt), jetzt verwerfen falsch.
3. **Fixierte Ziel-Architektur für die spätere L‑4-Spec** (damit die Weichen jetzt richtig stehen):
   - **Generischer Positions-Ingest:** ein authentifizierter Endpoint, der lat/lon (+ optional
     Zeitstempel/Genauigkeit) in den **vorhandenen** `einsatz_fahrzeug.lat/lon`-Slot schreibt —
     quellenagnostisch (App **oder** Tracker, OsmAnd/Traccar-kompatibles HTTP-Push-Muster).
     Downstream (Render/SSE/FMS-Badge) bleibt unverändert.
   - **Neu nötig:** Geräte-Kopplung (welches Gerät ↦ welche `einsatz_fahrzeug`-Zeile),
     `position_aktualisiert_at` für **Veralten/Stale-Anzeige** (manueller vs. automatischer Wert),
     und der Vorrang manuell ↔ automatisch.
   - **Datenschutz baulich:** einsatzbezogen + opt-in, **keine Positions-Historie** persistieren
     (Live-Wert, kein Track-Log), Betriebs-/Dienstvereinbarung als Rechtsgrundlage.
   - **Explizit ausgeschlossen:** TETRA/FMS-Mitlesen (regulatorisch/technisch versperrt) und
     Leitstellen-AVL-Kopplung (nicht offline/eigenständig) — beides bleibt außerhalb des
     self-hosted-Scopes.
4. **Vorbedingungen für die Umsetzungs-Spec:** (a) **bindend:** Mitbestimmung/Datenschutz geklärt
   (Betriebs-/Dienstvereinbarung); (b) **für Produktreife:** ein integrierter Quellpfad — eigene
   Besatzungs-App (Native-Apps-Roadmap, Schritt 0/Phase 2) — oder die bewusste Entscheidung für den
   Off-the-shelf-Traccar-Client-Interim.

### Risiken / Pre-Mortem (warum es scheitern könnte)

- **Eigene App kommt nie / spät** → keine *produktreife* Besatzungs-App; B bleibt als
  Off-the-shelf-Interim (Traccar-Client) machbar, nur klobiger, sonst rückt C nach. Mitigation:
  Ingest **quellenagnostisch** (OsmAnd/Traccar-kompatibel) halten, damit Off-the-shelf-Clients
  und C ohne Redesign passen.
- **Mitbestimmung blockiert** → Feature rechtlich tot; deshalb Gate *vor* der Spec, nicht danach.
- **Akku/Funkabdeckung/Update-Rate** → Positionen veralten; `position_aktualisiert_at` +
  Stale-Kennzeichnung machen das sichtbar statt trügerisch „live".

## Akzeptanzkriterien (LFH‑24)

- [x] Kurze Machbarkeits-Einschätzung dokumentiert (**geht — unter Bedingungen**; je Quelle begründet) → dieses Dokument.
- [x] Entscheidung getroffen: **nicht verwerfen**, L‑4 bleibt **geparkt** mit fixierter Ziel-Architektur + Vorbedingungen; volle Spec erst bei Mobile-App + geklärter Mitbestimmung.

## Referenzen (intern)

- `migrations/0035_lage_taktik.sql` — `einsatz_fahrzeug.lat/lon` (+`tz_*`), nullable/paarweise.
- `src/routes/einsatz_fahrzeug.rs` — Geo-PATCH `…/fahrzeuge/{ef_id}/position` (kein Positions-Zeitstempel, keine Historie).
- `src/fahrzeug/` (`disposition_repo.rs`, `status_repo.rs`) — `fahrzeug_status` (FMS-Status, kategorie/farbe), `dienststatus`.
- `src/live/mod.rs` (`LiveHub`, `publiziere_event`) + `src/routes/einsatz_fahrzeug.rs::sse_fahrzeug` — Event-Tag `fahrzeug` (Live-SSE).
- Specs: `2026-05-30-lage-karten-fundament-design.md` (L‑1, offline-first/PMTiles), `2026-05-31-lage-taktische-gliederung-design.md` (L‑2, manuelle Verortung → L‑4 vertagt), `2026-06-18-native-apps-roadmap-design.md` (Tauri‑2/offline-first/P2P = Träger der Besatzungs-App).
- *Hinweis:* Die in LFH‑24 & L‑1/L‑2 referenzierte `docs/superpowers/PROGRESS.md` existiert nicht (mehr) — die Entscheidung ist daher hier + im ClickUp-Task verankert.

## Quellen (extern, adversarial verifiziert)

- BDBOS — Dienste (Digitalfunk BOS), SDS/Positions-/Statusdienste: https://www.bdbos.bund.de/DE/Aufgaben/DigitalfunkBOS/Dienste/dienste_node.html
- „Taktische Statusmeldungen — Nutzung und Auswertung", Digitalfunk BW, 02/2025 (FRT/PEI-Auswertung, GPS-/landesweite Gruppe gesperrt): https://digitalfunk.baden-wuerttemberg.de/fileadmin/user_upload/Downloadportal/Regelungen_zum_Betriebshandbuch/Taktische_Statusmeldungen_022025.pdf
- Navigationssysteme am Digitalfunkgerät, Leitstelle Lausitz (PEI2/SDS-Push Leitstelle→Fahrzeug): https://www.leitstelle-lausitz.de/navigationssysteme-am-digitalfunkgeraet/
- DIVERA 24/7 — Leitstellenanbindungen nach Bundesland (vendor-/Land-spezifische AVL): https://help.divera247.com/display/FAQ/Leitstellenanbindungen+nach+Bundesland
- iSE COBRA 4 / WDX‑3 (Fahrzeugstatus+Position, einsatz-scoped): https://feuersoftware.com/doku/ise-cobra-4-wdx3-schnittstelle/
- eurocommand CommandX (DIN SPEC 91287, REST über Leitstelle): https://www.eurocommand.com/produkte/einsatzleitsysteme
- Traccar — Open-Source Self-Hosted GPS-Server: https://www.traccar.org/ · OsmAnd-Protokoll (Port 5055): https://www.traccar.org/osmand/ · heise (DE, Kosten/Pi): https://www.heise.de/ratgeber/GPS-Tracker-Server-Traccar-Ortungsportal-selbst-gemacht-9218537.html · Offline-LAN-Setup: https://webworxshop.com/self-hosted-gps-tracking-with-traccar-and-home-assistant/
- Meshtastic Off-Grid GPS (LoRa, kein SIM/Cloud): https://meshnology.com/blogs/meshnology-blog-1/diy-meshtastic-gps-tracker-build-your-own-off-grid-tracking-system-in-2026 · SenseCAP T1000‑E: https://www.wimo.com/en/sensecap-t1000e-meshtastic-tracker
- GPS-Überwachung am Arbeitsplatz & Datenschutz (§87 BetrVG, Verhältnismäßigkeit, VG Wiesbaden): https://www.dr-datenschutz.de/gps-ueberwachung-am-arbeitsplatz-und-der-datenschutz/
