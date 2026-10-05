# Tasks

## 1. Tastatur nach Zeigerart (D1, D3)

- [ ] 1.1 `etb/Schnellerfassung.test.tsx`: grober Zeiger (`matchMedia`), Enter sendet nicht und lässt den Umbruch stehen, Strg+Enter und ⌘+Enter senden, `enterKeyHint="enter"`; feiner Zeiger unverändert. Prüfen: rot vor 1.2
- [ ] 1.2 `etb/Schnellerfassung.tsx`: `istBeruehrung` aus `useViewport`, Weiche in `onKeyDown`, `enterKeyHint` am Feld (über `MarkdownEditor` durchreichen, falls nötig). Prüfen: 1.1 grün
- [ ] 1.3 Test und Umsetzung Hinweiszeile und Platzhalter je Zeigerart (`ENTER_HINWEIS_BERUEHRUNG`, neuer `PLATZHALTER_KURZ`). Prüfen: kein „Befehle“, keine Tastenkombination auf Touch

## 2. Feldbreite (D2)

- [ ] 2.1 `Schnellerfassungszeile.test.tsx`: Klasse `lfh-schnellerfassung__feld--fuellt` nur mit `feldFuellt`. Prüfen: rot vor 2.2
- [ ] 2.2 `Schnellerfassungszeile.tsx` (Prop, Dateikopf), `theme/sprache.css` (Regel und Kommentar), ETB setzt `feldFuellt`. Prüfen: 2.1 grün

## 3. Handschirm (D4)

- [ ] 3.1 `EtbPage.tsx`: unter `md` Menü „Weitere“ (Druckansicht, Abschließen mit `<Modal>`-Rückfrage), Test in `EtbPage.test.tsx`
- [ ] 3.2 Typfilter einzeilig rollend unter `md`
- [ ] 3.3 Knopf „Filter (n)“ klappt `EtbFilterleiste` auf, aktiver Filter hält sie offen, Test
- [ ] 3.4 Erfassungsleiste eingeklappt: `eingeklappt` an der Schnellerfassung, Reiterband nur ab zwei Entwürfen, Fokusweiche in `EtbPage`, kein Mount-Fokus unter `md`; Tests für Einklappen, Aufklappen bei Fokus und bei Inhalt
- [ ] 3.5 Infotelefon-Erfassung bei 390 × 844 messen, Ergebnis hier notieren

## 4. Browser-Nachweis (D5)

- [ ] 4.1 `e2e/leisten-flaeche.spec.ts`: Textarea ≥ 60 % auf 820/1180/1440; zwei Einträge auf 390 × 844 als Admin und als Rolle ohne Abschließen-Recht. Mutationsprobe dokumentieren
- [ ] 4.2 Mitlaufen: `leisten-flaeche`, `fokus-verdeckung`, `etb-entwurf-tabs`, `etb-chronologie`, `gate3-trefflaeche`

## 5. Regel und Gesamtlauf

- [ ] 5.1 `frontend/src/etb/AGENTS.md`, Abschnitt Erfassung: Zeigerweiche (Enter), Feldbreite per Opt-in, Einklappen unter `md`
- [ ] 5.2 `./scripts/check-all.sh` bzw. die in der Cloud-Sitzung lauffähigen Bündel; Abweichungen gegen `alpha` belegen
