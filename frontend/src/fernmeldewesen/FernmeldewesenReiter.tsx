import { Tabs } from 'antd';
import { useNavigate } from 'react-router';
import { funkplanPfad, kommunikationsplanPfad, type FunkplanAnsicht } from '../routing/deeplinks';

/** Ein Reiter des Moduls: eine Darstellung des Funkplans oder der Kommunikationsplan. */
export type FernmeldewesenReiterKey = FunkplanAnsicht | 'kommunikationsplan';

/** Die Reiter in der Reihenfolge der Spec `fernmeldewesen` („Modulseite mit vier Reitern“). */
export const FERNMELDEWESEN_REITER: readonly { key: FernmeldewesenReiterKey; label: string }[] = [
  { key: 'tabelle', label: 'Funkplan' },
  { key: 'skizze', label: 'Fernmeldeskizze' },
  { key: 'sprechgruppen', label: 'Sprechgruppen' },
  { key: 'kommunikationsplan', label: 'Kommunikationsplan' },
];

/**
 * Reiterleiste des Moduls Fernmeldewesen (LLH-1180, design.md D5) unter dem h1 „Fernmeldewesen“.
 * Funkplan, Fernmeldeskizze und Sprechgruppen sind Darstellungen EINER Seite: dort setzt ein Reiter
 * nur die Darstellung (`onDarstellung`); die Seite hält sie als `?ansicht=` in der Adresse, ohne
 * Verlaufsschritt (LLH-1432). Der Kommunikationsplan ist eine eigene Route; von dort führt ein
 * Darstellungsreiter mit `?ansicht=` auf den Funkplan.
 *
 * Nur die Leiste: der Inhalt steht darunter in der Seite, damit Druckwurzel und Seitenkopf bei der
 * Seite bleiben. `className` nimmt die Leiste aus dem Druck (`funkplan-no-print` …).
 */
export default function FernmeldewesenReiter({
  einsatzId,
  aktiv,
  onDarstellung,
  className,
}: {
  einsatzId: number;
  aktiv: FernmeldewesenReiterKey;
  /** Nur auf dem Funkplan: setzt die Darstellung, statt zu navigieren. */
  onDarstellung?: (ansicht: FunkplanAnsicht) => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const wechseln = (key: string) => {
    const reiter = key as FernmeldewesenReiterKey;
    if (reiter === aktiv) return;
    if (reiter === 'kommunikationsplan') {
      navigate(kommunikationsplanPfad(einsatzId));
    } else if (onDarstellung) {
      onDarstellung(reiter);
    } else {
      navigate(funkplanPfad(einsatzId, { ansicht: reiter === 'tabelle' ? undefined : reiter }));
    }
  };
  return (
    <Tabs
      className={className}
      activeKey={aktiv}
      onChange={wechseln}
      items={FERNMELDEWESEN_REITER.map((r) => ({ key: r.key, label: r.label }))}
    />
  );
}
