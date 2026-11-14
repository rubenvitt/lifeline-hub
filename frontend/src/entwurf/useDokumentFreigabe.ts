import { App } from 'antd';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Verlustschutz } from './useEntwurfVerlustschutz';

interface DokumentFreigabeOptionen<W extends object> {
  /** Das Formular der Seite; vor dem Dialog werden die Pflichtfelder geprüft. */
  form: { validateFields: () => Promise<W> };
  /** Der Verlustschutz der Seite: eine Pforte zum Speichern, sein Fehler und sein Lauf. */
  schutz: Pick<Verlustschutz<W>, 'speichereJetzt' | 'speicherFehler' | 'speichertGerade'>;
  /** Der Freigabe-Aufruf des Dokuments (`gibBefehlFrei`, `gibLageberichtFrei`). */
  gibFrei: () => Promise<unknown>;
  /** Erfolgs-Toast der Freigabe, z. B. „Befehl freigegeben“. */
  erfolgText: string;
  /** Nach erfolgreicher Freigabe, vor dem Toast (die Seite invalidiert ihre Abfragen). */
  onFreigegeben: () => void;
}

/**
 * Speichern → Freigeben → Dialog eines gegliederten Dokuments (LLH-1689), gemeinsam für Befehl und
 * Lagebericht. Die Seite reicht `dialog` an den `FreigabeDialog` und ruft `bestaetigen` am Knopf
 * „Freigeben“ und `speichern` im `onFinish` des Formulars.
 *
 * - **Speichern:** Ein Klick, ein PATCH. Der Klick blurrt zuerst das Feld, der Blur-Autosave ist
 *   schon unterwegs, und `speichereJetzt` hängt sich an ihn an. Quittung, Zeitstempel und
 *   `invalidate` liegen im Verlustschutz; hier bleibt der Erfolgs-Toast. Kein `onError`: der Grund
 *   steht als `speicherFehler` auf der Seite. Ein Toast daneben wäre eine zweite Wahrheit, die
 *   nach drei Sekunden geht.
 * - **Dialog:** Die validierten Werte des Freigabe-Versuchs sind zugleich der Auf-Zu-Zustand
 *   (`!== null` heißt offen). So kann der Dialog nicht ohne die Werte stehen, mit denen er
 *   gespeichert werden soll.
 * - **Freigeben:** `/freigeben` validiert den gespeicherten Stand, nicht den Editor-Inhalt. Darum
 *   wird erst gespeichert, über dieselbe Pforte wie der Knopf (ein laufender Blur-Autosave wird
 *   abgewartet, nicht gedoppelt), sonst würde ein eben befüllter Entwurf als „leer“ abgelehnt.
 *   Jede Ablehnung lässt den Dialog offen, ihr Grund steht darin (`speicherFehler`
 *   bzw. `freigabeFehler`).
 * - Kein eigener `sendetRef`-Riegel wie in `Erfassung.tsx`: antds `Button` sperrt seinen Klick
 *   selbst, solange `loading` steht, und der Knopf im Dialog ist der einzige Weg.
 */
export function useDokumentFreigabe<W extends object>({
  form,
  schutz,
  gibFrei,
  erfolgText,
  onFreigegeben,
}: DokumentFreigabeOptionen<W>) {
  const { message } = App.useApp();

  const speichernMutation = useMutation({
    mutationFn: (werte: W) => schutz.speichereJetzt(werte),
    onSuccess: () => message.success('Entwurf gespeichert'),
  });

  const [freigabeWerte, setFreigabeWerte] = useState<W | null>(null);

  const freigebenMutation = useMutation({
    mutationFn: gibFrei,
    onSuccess: () => {
      onFreigegeben();
      message.success(erfolgText);
    },
  });

  const bestaetigen = async () => {
    // Pflichtfelder vor dem Dialog prüfen — sonst landet ein Titel-Fehler hinter dem Modal.
    let werte: W;
    try {
      werte = await form.validateFields();
    } catch {
      return; // Validierungsfehler werden am Formular angezeigt.
    }
    // Ein frisch geöffneter Dialog zeigt keinen alten Grund: react-query hält `error` bis zum
    // nächsten `mutate()`.
    freigebenMutation.reset();
    setFreigabeWerte(werte);
  };

  const ausfuehren = async () => {
    if (freigabeWerte === null) return;
    try {
      // Bei Erfolg quittiert der Verlustschutz selbst: sonst fragte der Browser beim Neuladen
      // nach Änderungen an einem nicht mehr editierbaren Dokument.
      await schutz.speichereJetzt(freigabeWerte);
    } catch {
      // Kein Toast: der Grund steht als `speicherFehler` im Dialog, der offen bleibt. Der
      // Seiten-Alert bleibt daneben stehen, er überlebt das Schließen des Dialogs.
      return;
    }
    try {
      await freigebenMutation.mutateAsync();
    } catch {
      return; // Grund steht als `freigabeFehler` im Dialog; er bleibt offen.
    }
    setFreigabeWerte(null);
  };

  return {
    speichern: (werte: W) => speichernMutation.mutate(werte),
    /** Lauf des Knopfs „Entwurf speichern“ (nur für `loading` am Knopf, nie für einen Blocker). */
    speichertKnopf: speichernMutation.isPending,
    bestaetigen,
    /** Lauf der Freigabe selbst, für `loading` am Knopf „Freigeben“. */
    gibtFrei: freigebenMutation.isPending,
    /** Props für den `FreigabeDialog`, ohne `titel` und `warnung`. */
    dialog: {
      offen: freigabeWerte !== null,
      speicherFehler: schutz.speicherFehler,
      freigabeFehler: freigebenMutation.error,
      // `speichertGerade` deckt den Vorlauf ab, auch wenn der Klick sich an einen laufenden
      // Blur-Autosave anhängt. Hier richtig und nicht die Falle von `speichertKnopf`: dieser
      // Knopf existiert nur bei offenem Dialog, der Vorlauf ist genau der Vorgang, auf den der
      // Dialog wartet.
      laeuft: schutz.speichertGerade || freigebenMutation.isPending,
      onAbbrechen: () => setFreigabeWerte(null),
      onFreigeben: () => void ausfuehren(),
    },
  };
}
