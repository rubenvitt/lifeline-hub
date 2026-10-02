# Proposal

## Why

LFH-21 hat Fotos und PDF an Schäden gebracht und dabei die Anhang-Infrastruktur so
geschnitten, dass jeder weitere Linker einen Registereintrag kostet (`MODUL_LINKER`). Zwei
Erfassungsmodule fragen seitdem nach demselben Weg: **Tiere** (Foto eines herrenlosen
Tieres zur Wiedererkennung und Übergabe an das Tierheim) und **Unfallhilfsstellen** (Fotos
und Unterlagen der UHS, ihr Plan bzw. Grundriss). Heute bleibt dafür nur die
Dokumentenablage. Sie hat keinen Bezug auf Tier oder UHS, ist über das Modul `dokumente`
statt über das Fachmodul sichtbar und schreibt den Freitext-Titel ins ETB.

An der UHS kommt ein Risiko dazu, das Schäden und Tiere nicht tragen: Ein Foto oder eine
Liste aus der Behandlungsstelle kann Patienten zeigen. Das UHS-Modul führt Patienten heute
bewusst nur über Kennungen (`R-nnn`) und braucht deshalb kein Lese-Audit. Ein UHS-Anhang
bricht diese Voraussetzung. Deshalb protokolliert dieser Change jeden Abruf einer UHS-Datei
(Entscheidung des Auftraggebers am 02.10.2026).

## What Changes

- **Fotos und PDFs an einem Tier.** Die Tier-Detailseite bekommt das Paneel „Fotos und
  Dateien“, wie es die Schadens-Detailseite hat. Es gelten dieselben Regeln wie an Schäden:
  - **Rechte:** Ablegen braucht Schreibrecht, Lesen und Herunterladen den Lesezugriff auf das
    Modul Tiere, auch für Beobachter.
  - **Dateien:** Erlaubt sind Kamerabilder einschließlich HEIC/HEIF und PDF, eine Datei je
    Ablage, höchstens 25 MiB. Der Virenscan läuft vor dem Speichern.
  - **Eine Transaktion:** Datei, Verknüpfung und ETB-Nachweis entstehen gemeinsam.
  - **Entfernen** ist ein Soft-Delete mit Nachweis.
  - **ETB:** Der Eintrag ist pseudonym, etwa „Tier T-007: Foto abgelegt“, und nennt nie den
    Dateinamen.
  - **Storno:** Ein storniertes Tier lehnt Ablegen und Entfernen mit 409 ab. Ein
    abgeschlossenes oder vermisstes Tier nimmt weiter Dateien an.
  - **Kein Lese-Audit**, wie bei Tieren insgesamt.
- **Fotos, PDFs und der Plan an einer UHS.** Die UHS-Detailseite bekommt neben „Material“
  und „Bewegungen“ einen Reiter **„Dateien“**. Es gelten dieselben Regeln über das Modul
  Unfallhilfsstellen, mit drei Unterschieden:
  - **ETB-Text:** Er nennt die UHS über ihre Bezeichnung, etwa „UHS BHP 50: Foto abgelegt“.
    Die Bezeichnung bleibt bei der Schwärzung ohnehin stehen.
  - **Storno:** Eine stornierte UHS lehnt Schreiben mit 409 ab. Eine aufgelöste nimmt weiter
    Dateien an.
  - **Grundriss:** Ein Plan oder Grundriss als Datei ist ein normaler UHS-Anhang. Es gibt
    keinen Bezug „UHS“ in der Dokumentenablage.
- **Lese-Audit für UHS-Dateien.** Jeder Abruf einer UHS-Datei schreibt einen
  Protokolleintrag, bevor die Datei ausgeliefert wird. Das gilt für die bereinigte Fassung
  und für das Original.
  - **Eintrag:** Er hält fest, wer welche Datei in welcher Fassung wann abgerufen hat.
  - **Fail-closed:** Scheitert der Eintrag, wird nichts ausgeliefert.
  - **Einsicht:** Nur die Einsatzleitung sieht das Protokoll, im Reiter „Dateien“ als
    aufklappbare Liste „Zugriffe“.
  - **Hinweis:** Der Ablegen-Dialog sagt, dass Abrufe protokolliert werden.
  - **Tabelle:** Das Protokoll liegt in einer neuen, modulneutralen Tabelle. Den
    CHECK-Rebuild von `person_zugriff_audit`, den LFH-757 plant, berührt es nicht.
- **Abschottung wie bei Schäden.** Tier- und UHS-Dateien sind nur über die Adressen ihres
  Moduls erreichbar:
  - generischer Download: 404, generischer Löschpfad: 422, auch für die ablegende Person;
  - Chat: 400, ETB: 422;
  - sie erscheinen nicht in der Dokumentenablage;
  - der Orphan-Sweep hält sie.
- **Schwärzung** löscht Dateien und Verknüpfungen, auch entfernte. Die pseudonymen
  ETB-Einträge und das UHS-Zugriffsprotokoll bleiben stehen.
- **Live:** Ablegen und Entfernen verteilen die bestehenden Ereignisse `tier` bzw. `uhs`
  und das ETB-Ereignis.
- **Bereinigte Auslieferung und Original (LFH-747)** gelten auch an Tieren und UHS. Der
  normale Download liefert ein Bild ohne Standort und Gerätedaten. Das Original bekommen
  nur Einsatzleitung und System-Admin, mit ETB-Vermerk.
- **Ein gemeinsamer Erfassungs-Anhang-Kern (intern).** Schaden, Tier und UHS teilen sich
  einen Baustein für Liste, Ablage, Entfernen und Download-Lookup. Ein Deskriptor je Modul
  beschreibt Tabelle und Besitzer. Die Schaden-Anhänge ziehen ohne Verhaltensänderung auf
  diesen Kern um. Im Frontend werden `SchadenAnhaenge` und `SchadenAnhangAblegenModal` zu
  modulneutralen Bausteinen.

Keine Änderung ist **BREAKING**. Routen, DTOs und Tabellen kommen nur hinzu. Die
Schaden-Routen und ihr DTO bleiben gleich.

## Capabilities

### New Capabilities

- `tier-anhaenge`: Dateien (Fotos, PDF) an einem Tier ablegen, auflisten, herunterladen und
  entfernen. Umfasst Dateitypen, Größe und Scan, Rechte über das Modul Tiere und den
  Lebenszyklus des Tieres. Dazu kommen die pseudonyme ETB-Spur, die Live-Verteilung, die
  Abschottung, der Sweep und die Schwärzung.
- `uhs-anhaenge`: Dasselbe an einer Unfallhilfsstelle über das Modul Unfallhilfsstellen.
  Dazu kommt das Lese-Audit jedes Datei-Abrufs samt Einsicht für die Einsatzleitung.

### Modified Capabilities

- `anhang-metadaten`: Die bereinigte Auslieferung, das Original nur für Einsatzleitung und
  System-Admin und die Original-Aktion in der Oberfläche nennen bisher die Wege Chat,
  Dokumentenablage, ETB und Schaden. Tier und UHS kommen als Wege dazu.

## Impact

- **Migrationen** (Nummern ab `0135`, Stand 02.10.2026; vor dem PR mit
  `scripts/check-migrationen.sh` gegen frisches `origin/alpha` prüfen):
  - `einsatz_tier_anhang`, `uhs_anhang`: Linker nach dem Muster von
    `0126_einsatz_schaden_anhang.sql`;
  - `anhang_zugriff_audit`: append-only.
- **Backend:**
  - **Kern:** `src/anhang/repo.rs` (zwei Einträge in `MODUL_LINKER`), neuer Kern
    `src/anhang/erfassung.rs`, `src/schaden/anhang.rs` (zieht auf den Kern um), neue
    `src/tier/anhang.rs`, `src/uhs/anhang.rs` und `src/anhang/audit_repo.rs`.
  - **Routen:** neue `src/routes/tier_anhang.rs` und `src/routes/uhs_anhang.rs`, dazu
    `src/routes/mod.rs` und `src/app.rs`. In `src/routes/einsatz_tier.rs` und
    `src/routes/einsatz_uhs.rs` werden `sse_tier` und `sse_uhs` `pub(crate)`.
  - **Schwärzung und API-Doku:** `src/einsatz/schwaerzung_registry.rs` (drei Regeln),
    `src/api_doc.rs`.
  - **Tests:** neue `tests/tier_anhang.rs`, `tests/uhs_anhang.rs` und ein Scan-Binary.
    Ergänzt werden `tests/anhang.rs`, `tests/etb_anhang.rs`, `tests/dokument.rs`,
    `tests/anhang_metadaten.rs` und `tests/common/mod.rs`.
- **API:**
  - `GET|POST /api/einsaetze/{id}/tiere/{tid}/anhaenge`, `GET …/{aid}/datei`,
    `DELETE …/{aid}`;
  - dieselben Routen unter `/api/einsaetze/{id}/uhs/{uid}/anhaenge`;
  - dazu `GET /api/einsaetze/{id}/uhs/{uid}/anhaenge/zugriffe` (nur Einsatzleitung);
  - neue DTOs `TierAnhangAnzeige`, `UhsAnhangAnzeige` und `AnhangZugriffAnzeige`.
- **Frontend:**
  - **API:** `api/einsatzTier.ts`, `api/einsatzUhs.ts`, `api/queryKeys.ts`, Codegen
    (`openapi.json`, `types.generated.ts`, `api/types.ts`).
  - **Bausteine:** neue modulneutrale Bausteine unter `components/erfassungsAnhaenge/`;
    `pages/schaeden/SchadenAnhaenge*` werden dünne Hüllen darum.
  - **Seiten:** `pages/TiereDetailPage.tsx` (Paneel) und `pages/uhs/UhsDetailPage.tsx`
    (Reiter „Dateien“ samt Zugriffsliste).
- **Dokumentation:** `src/AGENTS.md`, Abschnitt Anhänge, bekommt einen Absatz „Tier- und
  UHS-Anhänge (LFH-758)“ und die Regel des gemeinsamen Kerns.
- **Nachweise:** e2e-Specs `e2e/tier-anhaenge.spec.ts` und `e2e/uhs-anhaenge.spec.ts` sowie
  eine Prüfliste Einsatztauglichkeit als `pruefliste.md` in dieser Change.
- **Keine neuen Abhängigkeiten.**
- **Nicht enthalten:**
  - ein Bild als Hintergrund des Platz-Layouts (`Grundriss.tsx`, Spec `uhs-grundriss`) →
    **LFH-999**;
  - Anhänge an Personen samt Lese-Audit in `person_zugriff_audit` → **LFH-757**;
  - Bildvorschau und Thumbnails → **LFH-759**;
  - eine Anhangzahl in den Listen von Tieren und UHS.
