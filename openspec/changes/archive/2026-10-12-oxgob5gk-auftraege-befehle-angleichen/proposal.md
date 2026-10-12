# Proposal

## Why

Die zwei Reiter des Moduls „Aufträge/Befehle“ sehen völlig verschieden aus und bedienen sich
verschieden (Ruben, 10.10.2026). Ein Einzelauftrag steht als dicke Karte mit allen Knöpfen in der
Liste, ein Einsatzbefehl als schlanke Karte, deren Titel die Seite verlässt. Wer im Einsatz beide
Führungsmittel nutzt, soll eine Bedienlogik lernen, nicht zwei. Der fachliche Unterschied bleibt:
ein Auftrag wird quittiert und vollzogen, ein Befehl ist ein Dokument mit Fassung und Freigabe
(LFH-972).

Zunder: https://zunder.rubeen.dev/#/aufgabe/oxgob5gkwun6y9j0zcga3c7r (LLH-1084)

## What Changes

- **Neuer Baustein `ListeDetail`** (Muster „Liste + Detailpaneel“): ab `lg` Liste links und Detail
  rechts, darunter klappt das Detail unter der gewählten Karte auf. Er trägt die Auswahl, die
  Zustände (lädt, Fehler, leer), das Aufspringen eines Deeplinks samt Hervorhebung und den
  Live-Zufluss der Liste (Schleuse und Sammelbanner wie die `Datensicht`).
- **Beide Reiter stehen auf diesem Baustein**: eine gemeinsame Filterleiste (Status-Segmente und
  Suche, bei Aufträgen dazu Richtung und Empfänger), gleich gebaute Bereichsköpfe und Karten aus
  denselben Teilen (`KommKarte`, Zeitspalte mit Kennung, Statuschips). Die Listenkarte trägt
  **keine Handlungen** mehr; Quittieren, Bearbeitung beginnen, Vollzug melden und Abnehmen stehen
  im Detail, mit den Rechte- und Rückgängig-Regeln von heute.
- **Einsatzbefehl im Detailpaneel lesen**: Lesefassung der Abschnitte, Fassung, Freigabe und
  Verlauf; „Freigeben“ (Entwurf) und „Fortschreiben“ (freigegeben) direkt im Detail. **Die
  Vollseite `…/auftraege/befehle/:id` bleibt** für das Schreiben eines Entwurfs, den Druck und als
  Deeplink-Ziel. Ihr Ortspfad führt mit `?befehl=<id>` zurück auf den gewählten Befehl.
- **„Auftrag erteilen“ als Modal** statt Inline-Paneel über der Liste; die Serienerfassung bleibt.
- **Server-Suche der Aufträge**: `GET /auftraege` und `GET /auftraege/kennzahlen` nehmen `q`
  (Kennung `#n`, Auftragstext, Empfänger). Damit findet die Suche auch ältere, noch nicht geladene
  abgeschlossene Aufträge (Regel LFH-1075). Die Befehle bleiben ungeblättert und werden im Client
  durchsucht.
- **Seitenzustände** über `SeitenSkeleton`/`SeitenFehler` statt `Spin`/`Alert`.
- **Leitlinie**: `frontend/AGENTS.md`, „UI-Form-Leitlinie“, bekommt die Form „Liste + Detailpaneel“
  neben Vollseite, Modal, Inline und Drawer.
- **Nicht in dieser Change**: Verteiler und Quittung für Befehle (Folgeticket LLH-1173), die
  Entwurfsseite selbst (LLH-1074, früher LFH-1214), Namen im Verlauf eines Auftrags (der Server
  liefert nur Kennungen).

## Capabilities

### New Capabilities

- `liste-detail`: das Muster „Liste + Detailpaneel“ als Baustein: Anordnung je Breite, Auswahl
  per Zeiger und Tastatur, Zustände, Deeplink und Hervorhebung, Zufluss der Liste und Verhalten,
  wenn das gewählte Objekt entfällt.
- `auftraege-befehle`: das Modul „Aufträge/Befehle“: gleicher Aufbau beider Reiter, Inhalt der
  Karten, Handlungen im Detail, Erfassen per Modal, Rolle der Befehl-Vollseite und die
  Server-Suche der Aufträge.

### Modified Capabilities

- `deeplink-hervorhebung`: Ein angesprungener Einsatzbefehl (`?befehl=`) wird wie ein Auftrag
  markiert, und die Markierung bleibt von der Auswahlfläche einer gewählten Karte unterscheidbar.
- `einsatztauglichkeit-layout`: Die Treffflächen-Liste für die Seite Aufträge nennt statt
  „Kopf Befehlsdetails“ und „Link einer Befehlskarte“ die Auswahlziele der Karten und die
  Handlungen des Detailpaneels.

## Impact

- **Frontend**:
  - neu: `components/ListeDetail.tsx`, `components/useZuflussSchleuse.ts` (aus `Datensicht`
    herausgelöst, `Datensicht` nutzt sie weiter)
  - umgebaut: `pages/AuftraegePage.tsx`, `auftraege/AuftraegeListe.tsx`, `auftraege/BefehlListe.tsx`,
    `auftraege/AuftragKarte.tsx` (in Teile zerlegt)
  - neu: `auftraege/AuftragDetail.tsx`, `auftraege/BefehlDetail.tsx`, `auftraege/AuftragErteilenDialog.tsx`
  - berührt: `pages/BefehlDetailPage.tsx` (Ortspfad), `routing/deeplinks.ts`, `api/auftraege.ts`,
    `api/queryKeys.ts`, `kommunikation/KommKarte.tsx` (Auswahlfläche), `components/Datensicht.tsx`
  - Wächter: `components/datensicht.guard.test.ts` (BefehlListe verlässt `NUR_KARTE`/`KONSUMENTEN`)
  - Abnehmer der Kartenteile ohne Verhaltensänderung: `geraet/GeraetAuftraegePage.tsx`,
    `command-palette/Vorschau.tsx` (`AuftragVorschau`)
- **Backend**: `src/routes/auftrag.rs`, `src/auftrag/repo.rs` (Parameter `q`); keine Migration,
  kein neues Response-DTO, kein Typ-Codegen.
- **Regeln**: `frontend/AGENTS.md` (UI-Form-Leitlinie, Deeplink-Muster), `src/AGENTS.md` (Suche der
  Auftragsliste).
- **Tests und Doku**: Vitest der betroffenen Komponenten, e2e `auftraege-abgeschlossen`,
  `befehl-navigation`, `befehl-aktionsleiste`, `etb-folgeauftraege`,
  `deeplink-hervorhebung-kontrast`, neue e2e für beide Abläufe; Kapitel
  `docs/anwender/kapitel/auftraege-befehle.md` und seine Bilder
  (`e2e/doku-bilder/auftraege-befehle.bilder.ts`).
- **Design System** „Lifeline Hub“ muss um den Baustein „Liste + Detailpaneel“ nachgezogen werden.
