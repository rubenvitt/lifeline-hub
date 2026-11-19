/**
 * Schuld des Schriftgrößen-Wächters (`schriftgroesse.guard.test.ts`, Spec `schriftstufen`):
 * Schriftgrößen-Literale je Datei (Pfad relativ zu `src/`). Die Zahl sinkt nur; wer Größen auf
 * Stufen umstellt, senkt sie im selben Commit, bei 0 fällt der Eintrag. Neue Einträge gibt es nicht.
 */
export const SCHULD: Readonly<Record<string, number>> = {
  'components/instrument/BearbeitbaresPaneel.tsx': 1,
  'components/instrument/DashboardPaneel.tsx': 1,
  'components/instrument/Datenraster.tsx': 1,
  'components/instrument/GliederungsPaneel.tsx': 1,
  'components/instrument/Kennzahl.tsx': 1,
  'components/instrument/ListenPaneel.tsx': 2,
  'components/instrument/MatrixPaneel.tsx': 1,
  'components/instrument/PaneelZustand.tsx': 5,
  'components/instrument/Sammelbanner.tsx': 1,
  'components/instrument/VerteilungsPaneel.tsx': 1,
  'components/instrument/Zeitachseneintrag.tsx': 1,
  'fernmeldewesen/skizze/SkizzenElemente.tsx': 2,
  'pages/EinsaetzePage.css': 1,
  'pages/lagekarte/LageplanDruck.tsx': 1,
  'pages/lagekarte/bildGriffe.ts': 1,
  'pages/lagekarte/clusterDonut.ts': 1,
  'pages/lagekarte/lagekarte.css': 1,
  'theme/sprache.css': 3,
  'wetter/Verlaufslinie.tsx': 1,
};
