-- LLH-1055: Empfänger einer Verpflegungsausgabe (design.md D1, LLH-1024 F3). Mengen, keine
-- Personen: Empfänger ist höchstens EINE Einheit (Abholung, steht für ihren Teilbaum) oder EIN
-- Abschnitt (Zuführung), nie eine Person. Die Ausgabe trägt nur die Kennung, Namen kommen aus der
-- Empfängerliste von `GET …/verpflegung`.
--
-- „Höchstens ein Empfänger“ prüft die Anwendung (422 in `verpflegung::repo::ausgabe_erfassen_tx`);
-- ein CHECK bräuchte einen Neubau der Tabelle samt Indizes und Spalten aus 0133 und 0206.
-- Eine Ausgabe an eine Einheit ist eine Spur der Einheit (`einheit::repo::SPUREN_EINHEIT`):
-- Auflösen löscht sie nicht, Stornieren ist 422. `ON DELETE SET NULL` ist nur das Netz für das
-- Löschen des Einsatzes; ein Abschnitt wird echt gelöscht, die Ausgabe zählt dann ohne Empfänger
-- weiter in die Deckung. Nur additiv: der Bestand bleibt ohne Empfänger.
ALTER TABLE verpflegung_ausgabe ADD COLUMN einheit_id INTEGER
    REFERENCES einsatz_einheit(id) ON DELETE SET NULL;
ALTER TABLE verpflegung_ausgabe ADD COLUMN abschnitt_id INTEGER
    REFERENCES einsatzabschnitt(id) ON DELETE SET NULL;

-- Spurprüfung beim Auflösen und SET NULL beim Löschen; die meisten Ausgaben haben keinen Empfänger.
CREATE INDEX idx_verpflegung_ausgabe_einheit ON verpflegung_ausgabe(einheit_id)
    WHERE einheit_id IS NOT NULL;
CREATE INDEX idx_verpflegung_ausgabe_abschnitt ON verpflegung_ausgabe(abschnitt_id)
    WHERE abschnitt_id IS NOT NULL;
