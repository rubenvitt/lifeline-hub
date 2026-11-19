import { Button } from 'antd';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { meldeClientFehler } from '../api/clientFehler';
import { GROSS_BEZUG, grossMass } from './grossbild/grossMass';
import { IM_RASTER } from './instrument/DashboardPaneel';
import Paneel from './instrument/Paneel';
import { useRollen } from './instrument/rollenwerte';

/**
 * Fehlergrenze je Kachel (LLH-1958; Regel „Jede Kachel einer Lagefläche hat ihre eigene
 * Fehlergrenze“ in `frontend/AGENTS.md`; Entwurf
 * `docs/superpowers/specs/2026-11-19-ft74hjiv-fehlergrenze-je-kachel-design.md`).
 *
 * Wirft eine Kachel von Überblick, Lagebild, Großbild oder Lagemonitor beim Zeichnen, fällt nur
 * sie aus. Die Nachbarn bleiben stehen, und die Rahmengrenze (`Fehlergrenze.tsx`) erreicht der
 * Wurf nie. Deshalb geht genau ein Bericht über `meldeClientFehler`. Meldung und Stack stehen nie
 * im DOM.
 *
 * Die Grenze ist eine Klasse, weil React Würfe nur dort fängt. Ihre Hülle ist ein `div` mit
 * `display: contents`: Grid und Flex der Reihe sehen weiter die Kachel als Kind. Die Marke
 * `data-lfh-kachelgrenze` dient dem Wächter (`test/kachelWaechter.ts`).
 *
 * Form `paneel` (Vorgabe) für Flächen mit Bedienung: der Ersatz im Fugenraster, Kante in `alarm`,
 * „Neu laden“ wie die Rahmengrenze. Form `gross` für Flächen ohne Bedienung (Lagemonitor,
 * Großbild): kein Knopf, Schrift aus der Großbild-Skala. Ändert sich `neuversuch` (der Datenstand
 * der Seite), zeichnet die Grenze die Kachel erneut.
 */
export const KACHELGRENZE_TITEL = 'Diese Kachel konnte nicht angezeigt werden';

/** Greifer der Hülle, für den Wächter. */
export const KACHELGRENZE_SELEKTOR = '[data-lfh-kachelgrenze]';

export interface KachelGrenzeProps {
  /** Name der Kachel im Ersatz. */
  titel: string;
  form?: 'paneel' | 'gross';
  /** Ändert sich der Wert, versucht die Grenze die Kachel erneut. */
  neuversuch?: unknown;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  neuversuch: unknown;
}

export default class KachelGrenze extends Component<KachelGrenzeProps, State> {
  constructor(props: KachelGrenzeProps) {
    super(props);
    this.state = { hasError: false, neuversuch: props.neuversuch };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: KachelGrenzeProps, state: State): Partial<State> | null {
    return Object.is(props.neuversuch, state.neuversuch)
      ? null
      : { hasError: false, neuversuch: props.neuversuch };
  }

  componentDidCatch(fehler: unknown, _info: ErrorInfo): void {
    void meldeClientFehler(fehler, window.location.pathname);
  }

  render() {
    const { titel, form = 'paneel', children } = this.props;
    return (
      <div data-lfh-kachelgrenze="" style={{ display: 'contents' }}>
        {this.state.hasError ? <KachelErsatz titel={titel} form={form} /> : children}
      </div>
    );
  }
}

function KachelErsatz({ titel, form }: { titel: string; form: 'paneel' | 'gross' }) {
  const { token: t, rollen } = useRollen();
  if (form === 'gross') {
    return (
      <section
        data-lfh="kachelgrenze"
        aria-label={titel}
        style={{
          background: rollen.flaeche,
          border: `1px solid ${rollen.linie}`,
          boxShadow: `inset 3px 0 0 0 ${rollen.alarm}`,
          borderRadius: 8,
          padding: '16px 24px',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: grossMass(GROSS_BEZUG.titel), color: rollen.text }}>
          {titel}
        </h2>
        <span style={{ fontSize: grossMass(GROSS_BEZUG.text), color: rollen.text2 }}>
          {KACHELGRENZE_TITEL}.
        </span>
      </section>
    );
  }
  return (
    <Paneel
      titel={titel}
      koerperPolster
      // Die Kante trägt „gescheitert“ zusätzlich zum Wortlaut (WCAG 1.4.1), wie die Rahmengrenze.
      style={{ ...IM_RASTER, boxShadow: `inset 3px 0 0 0 ${rollen.alarm}` }}
    >
      <div
        data-lfh="kachelgrenze"
        style={{ display: 'flex', flexDirection: 'column', gap: t.marginXS }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: rollen.text }}>
          {KACHELGRENZE_TITEL}
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: rollen.text2 }}>
          Der Fehler wurde gemeldet.
        </p>
        <div>
          <Button type="primary" onClick={() => window.location.reload()}>
            Neu laden
          </Button>
        </div>
      </div>
    </Paneel>
  );
}
