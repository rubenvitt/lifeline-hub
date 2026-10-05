# Tasks

## 1. Tastatur nach Zeigerart (D1, D3)

- [x] 1.1 `etb/Schnellerfassung.test.tsx`: grober Zeiger (`matchMedia`), Enter sendet nicht und lässt den Umbruch stehen, Strg+Enter und ⌘+Enter senden, `enterKeyHint="enter"`; feiner Zeiger unverändert. Prüfen: rot vor 1.2
- [x] 1.2 `etb/Schnellerfassung.tsx`: `istBeruehrung` aus `useViewport`, Weiche in `onKeyDown`, `enterKeyHint` am Feld (über `MarkdownEditor` durchreichen, falls nötig). Prüfen: 1.1 grün
- [x] 1.3 Test und Umsetzung Hinweiszeile und Platzhalter je Zeigerart (`ENTER_HINWEIS_BERUEHRUNG`, neuer `PLATZHALTER_KURZ`). Prüfen: kein „Befehle“, keine Tastenkombination auf Touch

## 2. Feldbreite (D2)

- [x] 2.1 `Schnellerfassungszeile.test.tsx`: Klasse `lfh-schnellerfassung__feld--fuellt` nur mit `feldFuellt`. Prüfen: rot vor 2.2
- [x] 2.2 `Schnellerfassungszeile.tsx` (Prop, Dateikopf), `theme/sprache.css` (Regel und Kommentar), ETB setzt `feldFuellt`. Prüfen: 2.1 grün

## 3. Handschirm (D4)

- [x] 3.1 `EtbPage.tsx`: unter `md` Menü „Weitere“ (Druckansicht, Abschließen mit `<Modal>`-Rückfrage), Test in `EtbPage.test.tsx`
- [x] 3.2 Typfilter einzeilig rollend unter `md`
- [x] 3.3 Knopf „Filter (n)“ klappt `EtbFilterleiste` auf, aktiver Filter hält sie offen, Test
- [x] 3.4 Erfassungsleiste eingeklappt: `eingeklappt` an der Schnellerfassung, Reiterband nur ab zwei Entwürfen, Fokusweiche in `EtbPage`, kein Mount-Fokus unter `md`; Tests für Einklappen, Aufklappen bei Fokus und bei Inhalt
- [ ] 3.5 Infotelefon-Erfassung bei 390 × 844 messen, Ergebnis hier notieren

## 4. Browser-Nachweis (D5)

- [x] 4.1 `e2e/leisten-flaeche.spec.ts`: Textarea ≥ 60 % auf 820/1180/1440; zwei Einträge auf 390 × 844 als Admin und als Rolle ohne Abschließen-Recht. Mutationsprobe dokumentieren
  - Gemessen (05.10.2026): Feld 476 von 772 px (62 %) bei 820, 568 von 864 px (66 %) bei 1180,
    550 von 846 px (65 %) bei 1440. Auf 390 × 844 Leiste ab y = 753 (91 px), 5 Einträge ganz
    darüber, als Admin wie als Führungspersonal.
  - Mutationsprobe: ohne `feldFuellt` 158 von 772 px (20 %), rot. Ohne Einklappen
    (`einklappbar={false}`) Leiste 220 px (Admin) bzw. 376 px (Führungspersonal, mit
    Rufname-Abfrage), Führungspersonal sieht nur einen Eintrag, rot. Der alte Kopf allein lässt
    3 bis 4 Einträge stehen und bleibt im Browser grün; ihn hält `pages/EtbPage.test.tsx`
    („Handschirm“: Menü, Filterknopf, Typfilter einzeilig; vor der Umsetzung 8 von 10 rot).
- [ ] 4.2 Mitlaufen: `leisten-flaeche`, `fokus-verdeckung`, `etb-entwurf-tabs`, `etb-chronologie`, `gate3-trefflaeche`

## 5. Regel und Gesamtlauf

- [x] 5.1 `frontend/src/etb/AGENTS.md`, Abschnitt Erfassung: Zeigerweiche (Enter), Feldbreite per Opt-in, Einklappen unter `md`
- [ ] 5.2 `./scripts/check-all.sh` bzw. die in der Cloud-Sitzung lauffähigen Bündel; Abweichungen gegen `alpha` belegen
