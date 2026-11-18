# Spec Delta

## ADDED Requirements

### Requirement: Stapel nehmen nur Rasterstufen

Ein Layoutbaustein, der Elemente senkrecht oder waagerecht reiht, SHALL seinen Abstand nur als benannte Stufe (`xxs`, `xs`, `sm`, `md`, `lg`, `xl`) annehmen und den Wert aus dem Raster der aktiven Dichtestufe lesen. Eine Zahl als Abstand MUST NOT übergeben werden können.

#### Scenario: Stapel in komfortabel
- **WHEN** ein Stapel mit Abstand `md` in der Dichtestufe `komfortabel` steht
- **THEN** beträgt die Lücke zwischen seinen Elementen 20 px

#### Scenario: Stapel in kompakt
- **WHEN** derselbe Stapel in `kompakt` steht
- **THEN** beträgt die Lücke 12 px
