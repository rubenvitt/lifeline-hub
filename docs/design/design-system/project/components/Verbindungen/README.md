# Verbindungen (Funk und Telefon getrennt; Liste offen)

Baustein „Verbindungen“ (LLH-1134, Entscheidung LLH-1126 Option B): Telefon und weitere
Verbindungen außerhalb des Funks als Liste „Mittel · Wert · Hinweis“, wie die Stellen des
Kommunikationsplans. Abschnitt, Einheit und eigene Führungsstelle nehmen ihn unter
„Telefon und weitere Verbindungen“; Funk (Rufname, Sprechgruppen) steht getrennt davon.

- **Lesen** (`VerbindungenListe`): je Verbindung das Mittel gedämpft, der Wert in Mono,
  `tel:` nur für Festnetz und Mobil, `mailto:` nur mit `@` (`verbindungen.ts`), der Hinweis
  gedämpft dahinter.
- **Bearbeiten** (`VerbindungenAngabe`): eine `InlineAngabe` über die ganze Liste; der
  Server ersetzt sie vollständig (`verbindungen`). Leere Zeilen fallen beim Speichern weg, ein
  Hinweis ohne Nummer wird nicht gesendet. Höchstens `VERBINDUNGEN_MAX` Einträge, Wert und
  Hinweis je höchstens `VERBINDUNG_TEXT_MAX` Zeichen (Spiegel der Servergrenzen).

Aus `frontend/src/components/FunkUndTelefon.tsx`:

Funk und Telefon getrennt (LLH-1134, Entscheidung LLH-1126 Option B): Lesezeilen für Abschnitt
und Einheit in einem `Datenraster`.

Quelle: `frontend/src/components/VerbindungenFeld.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einem Klick im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
