# Proposal

## Why

„Einheit aus Vorlage bilden“ (LLH-1049) übernimmt Einheiten, Fahrzeuge und Stammbesetzung, aber
kein Material. Wer einen Sanitätszug bildet, disponiert danach jeden Rucksack und jede Kiste
Wolldecken einzeln und ordnet sie Einheit oder Fahrzeug zu. Seit dem Material-Modell (LLH-1224)
hat jeder Posten genau einen Ort, auch eine Einheit oder ein Fahrzeug. Damit kann die Vorlage ihr
Material mitbringen (Zunder LLH-1261).

## What Changes

- Eine Einheiten-Vorlage führt eine Liste von **Material-Positionen**: Stamm-Material der eigenen
  Organisation, Menge und Ort. Der Ort ist die Einheit der Vorlage oder eines ihrer Fahrzeuge. Die
  Liste wird als Ganzes ersetzt (`PUT /api/einheit-vorlagen/{id}/material`). Ein Gerät mit
  Bestandsnummer steht höchstens einmal im Vorlagen-Baum und mit Menge 1.
- Die Detailseite der Vorlage in der Verwaltung bekommt die Sektion „Material“.
- Die Vorschau im Einsatz nennt je Einheit ihre Material-Positionen mit Zustand: „neu“,
  „außer Dienst“ oder „schon im Einsatz“. Der letzte Zustand betrifft ein Gerät mit
  Bestandsnummer, das schon aktiv im Einsatz steht.
- Die Seite „Einheit aus Vorlage bilden“ zeigt je Position ein Häkchen, vorgegeben an. Gesperrt
  ist eine Position, die außer Dienst oder schon im Einsatz steht. Kommt das Fahrzeug einer
  Position nicht mit, steht an ihr „an der Einheit“.
- Das Bilden disponiert die gewählten Positionen **in derselben Transaktion**. Ein Gerät ergibt
  einen Posten je Stück, ein Verbrauchsgut einen Posten mit Menge. Ort ist das Fahrzeug, wenn es
  mitkommt, sonst die Einheit der Position. Der eine ETB-Sammeleintrag nennt das Material, die
  Antwort nennt die neuen Posten, und nach dem Commit folgen die Live-Ereignisse.
- Rechte: Mit Material verlangt das Bilden Schreibrecht am Modul Material (403). Ohne Freigabe
  zeigt die Vorschau das Material als gesperrt.
- Der Zeilen-Grund eines 422 kennt die Art `material` (neuer Wire-Wert von `ZeilenArt`).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einheit-vorlagen`: Neu ist die Anforderung „Material der Vorlage“. Geändert werden „Pflege in
  der Verwaltung“ (Sektion Material), „Vorschau im Einsatz“ (Material mit Zustand), „Vorschau
  achtet die Modulfreigabe“ (Modul Material) und „Seite zum Bilden aus der Vorlage“ (Häkchen je
  Position, „an der Einheit“).
- `kraefte-disposition`: Neu ist die Anforderung „Material beim Bilden aus Vorlage“. Geändert
  werden „Ein ETB-Eintrag beim Bilden aus Vorlage“ (nennt Material, Live-Ereignis Material),
  „Bilden aus Vorlage ist gedeckelt“ (höchstens 50 Positionen) und „Rechte beim Bilden aus
  Vorlage“ (Modul Material).

## Impact

- Backend: neue Migration `einheit_vorlage_material`; `src/einheit_vorlage/` (DTO, Repo, Lesen
  und Ersetzen), `src/einheit/aus_vorlage.rs` (Plan, Vorschau, Abgleich, Bilden, ETB-Text),
  `src/einheit/mod.rs` (`etb_text_aus_vorlage`), `src/routes/einsatz_einheit.rs` (Body, Rechte,
  Live), Route für das Ersetzen der Material-Liste in `src/routes/` und `src/app.rs`,
  `src/error.rs` (`ZeilenArt::Material`), `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs`.
  Wiederverwendet werden `material::disposition_repo::disponiere_stamm_tx` und
  `material::ort::set_ort_tx`.
- Generierte Typen (`scripts/check-typ-codegen.sh`): `EinheitVorlage`, Vorschau, Ergebnis,
  `ZeilenArt`.
- Frontend: `api/einheitVorlagen.ts`, `stammdaten/EinheitVorlageSections.tsx` und
  `EinheitVorlageDetailPage.tsx` (Sektion Material), `einheit/ausVorlageKern.ts` und
  `pages/EinheitAusVorlagePage.tsx` (Häkchen, Zusammenfassung, Anfrage, Gründe je Zeile),
  `test/einheitVorlagen.ts`; e2e `einheit-aus-vorlage.spec.ts`.
- Doku: `docs/anwender/kapitel/stammdaten.md` (Einheiten-Vorlagen) und
  `docs/anwender/kapitel/einheiten.md` (Einheit aus Vorlage bilden).
- Demo-Daten unverändert: Eine Demo-Vorlage nimmt ihre Positionen beim Entfernen per Kaskade mit.
  Ein Demo-Material, auf das eine echte Vorlage verweist, bleibt wie ein Fahrzeug stehen.
