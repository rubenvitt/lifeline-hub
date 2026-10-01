import { Space } from 'antd';
import type { ReactNode } from 'react';
import StatusTag from './StatusTag';
import type { StatusDarstellung } from '../theme/statusFarben';

/**
 * Herkunftsmarke für Demo-Stammdaten (LFH-733; Regel in `frontend/AGENTS.md`, Bedien-Leitlinie;
 * Herleitung in `openspec/changes/lfh-733-demo-stammdaten-kennzeichnen/design.md` D4).
 *
 * Der Wortlaut „Demo“ trägt die Bedeutung, der Rahmen ist der zweite Kanal; eine Farbe braucht
 * die Marke nicht (WCAG 1.4.1). `neutral` statt `achtung`: Herkunft ist kein Warnzustand, und
 * ein gelbes Signal neben jedem Demo-Fahrzeug schwächte `achtung` dort, wo es einen Zustand
 * meint. Eine Einzeldarstellung, keine Vertragskarte (Vorlage `OHNE_STATUS` in
 * `kraefte/statusAchse.ts`).
 *
 * Steht neben der Kennung, nie in ihrem Link: der zugängliche Name des Links bleibt die Kennung.
 */
export const DEMO_MARKE: StatusDarstellung = { rolle: 'neutral', label: 'Demo' };

export default function DemoMarke() {
  return (
    <StatusTag darstellung={DEMO_MARKE} darstellungsart="rand" title="Angelegt vom Demo-Import" />
  );
}

/**
 * Kennung samt Marke: ohne `demo` nur die Kennung, mit `demo` die Marke daneben. Die Marke liegt
 * außerhalb von `children`, also auch außerhalb eines Links darin.
 */
export function MitDemoMarke({
  demo,
  children,
}: {
  demo: boolean | undefined;
  children: ReactNode;
}) {
  if (!demo) return <>{children}</>;
  return (
    <Space size="small">
      {children}
      <DemoMarke />
    </Space>
  );
}
