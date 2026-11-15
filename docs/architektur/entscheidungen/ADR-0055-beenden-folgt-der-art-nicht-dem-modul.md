---
id: ADR-0055
titel: Beenden folgt der Art, nicht dem Modul
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - frontend/src/pages/**
  - frontend/src/components/BeendenAbschnitt.tsx
  - frontend/src/components/useHoldGeloest.ts
  - frontend/src/kraefte/MaterialAmOrt.tsx
  - src/fahrzeug/disposition_repo.rs
herleitung:
  - openspec/changes/tfq6f4kb-loesende-aktionen/design.md
---

# ADR-0055: Beenden folgt der Art, nicht dem Modul

## Regeln

- MUST: Jede Handlung, die einen Datensatz beendet, gehört zu genau einer der fünf Arten (Zuordnung
  lösen, Kraft entlassen, Gebilde auflösen oder schließen, Fehlanlage stornieren, eigene Buchung
  zurücknehmen) und folgt deren Verb, Ort und Sicherung; die Tabelle steht in `frontend/AGENTS.md`,
  „Beenden: Verb, Ort und Sicherung je Art“.
- MUST NOT: „Entlassen“ oder „Aus dem Einsatz nehmen“ als Hauptaktion (`aktion`) einer Karte.
- MUST NOT: „Stornieren“ als sichtbarer Knopf im Kopf oder als Hauptaktion; es steht im letzten
  Abschnitt oder im ⋮. Die Prüfung fängt Hauptaktion und einzeiligen Knopf, einen mehrzeiligen
  Kopfknopf fängt nur der Review.
- MUST NOT: ein Rückgängig-Hinweis, dessen Rückweg nicht den Zustand vor der Handlung herstellt,
  außer bei den in `frontend/AGENTS.md` benannten Lücken.
- MUST: Im ⋮-Menü steht nur Unumkehrbares rot (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich
  destruktiv“; Wächter `frontend/src/components/menueFarbe.guard.test.ts`).
- MUST: Der letzte Abschnitt zum Auflösen und Stornieren geht über
  `frontend/src/components/BeendenAbschnitt.tsx`, eine gelöste Zeile hält ihre Stelle über
  `frontend/src/components/useHoldGeloest.ts`; kein zweiter Baustein dafür.
- SHOULD: Der Kopf einer Detailseite zeigt höchstens zwei Handlungen als Knopf, der Rest im ⋮.

## Prüfung

```sh
verbiete "etikett: '(Entlassen|Aus dem Einsatz nehmen|Stornieren)'" 'frontend/src/pages/**/*Page.tsx'
verbiete '<Button[^>]*>Stornieren</Button>' 'frontend/src/pages/**/*.tsx'
verlange 'BeendenAbschnitt' frontend/src/pages/einheit/EinheitAufloesen.tsx
verlange 'BeendenAbschnitt' frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx
verlange 'useHoldGeloest' frontend/src/kraefte/MaterialAmOrt.tsx
verlange 'useHoldGeloest' frontend/src/pages/einheit/FahrzeugeBesatzung.tsx
verlange 'nimmEntlassungZurueck' frontend/src/pages/FahrzeugePage.tsx
verlange 'pub async fn zuruecknehmen_tx' src/fahrzeug/disposition_repo.rs
```

## Kontext

Die UI/UX-Analyse vom 12.11.2026 fand sieben Verben fürs Beenden mit vier Sicherungsstufen.
„Entlassen“ war der größte Knopf jeder Fahrzeugkarte, und sein Rückgängig stellte nur „aktiv“ her,
ohne Einheit, Besatzung, Raum und Status. Ein roter Zeilenknopf im Einheit-Detail löste ohne
Rückweg, und ein Doppeltipp traf die nachrückende Zeile. Zwei Regeln widersprachen sich bei der
Farbe. Mehr als ein Weg war vertretbar; die Abwägung steht in der Herleitung.

## Konsequenzen

Wer eine beendende Handlung baut, wählt die Art und erbt Verb, Ort und Sicherung, statt sie je Modul
zu erfinden. Ein Rückgängig verspricht den Stand davor; wo der Server das noch nicht kann, steht
die Lücke benannt in der Regel und als Folgeaufgabe. Endgültiges steht abgesetzt und gebündelt,
Umkehrbares neutral im Menü; die Farbe trägt damit wieder Information.
