# Spec Delta

## ADDED Requirements

### Requirement: „Status setzen“ wirkt auf die Fokuszeile
Die Palette SHALL in der Gruppe „Aktionen“ die Aktion „Status setzen“ genau dann anbieten, wenn
der Tastaturfokus beim Öffnen der Palette in einer Listenzeile lag, also in einer Tabellenzeile
oder einer Karte, deren Status die Person dort wechseln kann. Diese Zeile ist die Fokuszeile.
Beim Ausführen MUST die Palette schließen und das Statusmenü genau dieser Zeile öffnen, mit dem
Tastaturfokus im Menü. Den Wert wählt die Person dort. Die Aktion MUST keinen Status von sich aus
setzen und MUST auf keine andere Zeile wirken.

Ohne Fokuszeile MUST die Aktion fehlen. Das gilt auch dann, wenn die Palette ohne Fokus in einer
registrierten Fläche geöffnet wird (etwa über den Knopf „Suchen“) und die Seite Zeilen mit
Statuswechsel zeigt. Sie MUST ebenso fehlen, wenn die Zeile keinen Statuswechsel anbietet: ohne
Schreibrecht, während sie gesperrt ist oder während ihr Statuswechsel läuft.

Die Aktion MUST ohne Tastenkürzel angezeigt werden. Sie MUST keine der Tasten Escape, Strg/⌘+S,
Strg/⌘+↵ oder Strg/⌘+Rücktaste belegen.

#### Scenario: Fokus in einer Zeile
- **WHEN** der Fokus auf der Kennung des Fahrzeugs „Florian 2“ in der Fahrzeugliste steht und Strg+K gedrückt wird
- **THEN** zeigt die Palette unter „Aktionen“ die Zeile „Status setzen“ ohne Tastenkürzel

#### Scenario: Wirkung auf genau diese Zeile
- **WHEN** „Status setzen“ bei Fokus in der Zeile „Florian 2“ ausgeführt wird, während darüber die Zeile „Florian 1“ steht
- **THEN** schließt sich die Palette, das Statusmenü von „Florian 2“ ist geöffnet und hat den Fokus, das Menü von „Florian 1“ bleibt zu, und kein Status wurde geändert

#### Scenario: Kein Fokus in einer Zeile
- **WHEN** der Fokus im Suchfeld der Liste steht und Strg+K gedrückt wird
- **THEN** fehlt „Status setzen“ in der Palette

#### Scenario: Über den Suchen-Knopf geöffnet
- **WHEN** die Palette per Klick auf „Suchen“ geöffnet wird und die Seite Zeilen mit Statuswechsel zeigt
- **THEN** fehlt „Status setzen“ in der Palette

#### Scenario: Zeile ohne Statuswechsel
- **WHEN** der Fokus in einer Zeile steht, deren Statuswechsel gesperrt ist oder für die die Person kein Schreibrecht hat, und Strg+K gedrückt wird
- **THEN** fehlt „Status setzen“ in der Palette

#### Scenario: Weitere Aktionen der Seite bleiben
- **WHEN** der Fokus in einer Zeile einer Seite mit der Aktion „Neue Zeile“ steht und Strg+K gedrückt wird
- **THEN** stehen „Status setzen“ und „Neue Zeile“ zusammen unter „Aktionen“
