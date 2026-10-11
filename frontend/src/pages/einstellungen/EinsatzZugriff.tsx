import { useEffect } from 'react';
import { useParams } from 'react-router';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { RechteHinweis } from '../../components/SpeicherHinweis';
import { NUR_LEITUNG } from '../../components/nurAnsicht';
import { useRollen } from '../../components/instrument';
import { darfEinsatzLeiten } from '../../einsatz/schreibrecht';
import MitgliederAbschnitt from '../MitgliederAbschnitt';
import { useEinstellungenAuftrag, useEinstellungenDaten } from '../EinsatzEinstellungenPage';

/**
 * Sektion `…/einstellungen/zugriff` — Mitglieder, Rollen und Führungsstelle je Person (LFH-1170,
 * Spec `einsatz-zugriff`). Bis dahin ein Paneel der Einsatzdaten; wer in den Einsatz darf, ist
 * Verwaltung wie die Gerätekopplung und hat dieselbe Rechtegrenze.
 *
 * Die Rechte sind die des Paneels: bedienen darf die Einsatzleitung eines laufenden Einsatzes
 * (`darfEinsatzLeiten`, ohne Admin-Zweig wie der Server); das deckt auch die Führungsstelle je
 * Person, denn `mitglied_setzen` fordert dieselbe Einsatzrolle. Alle anderen lesen die Liste mit
 * dem Grund. Am abgeschlossenen Einsatz steht „Einsatz abgeschlossen“ schon über den Reitern.
 *
 * Der Auftrag der Schnellaktion „Mitglied aufnehmen“ (`?neu=1`, LFH-1170) öffnet die
 * Personenauswahl einmal, beim Einhängen; danach räumt die Sektion ihn aus der Adresse. Ohne
 * Leitungsrecht gibt es keine Auswahl, der Auftrag verfällt ebenso.
 */
export default function EinsatzZugriff() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { token } = useRollen();
  const daten = useEinstellungenDaten(einsatzId);
  const { mitgliedAufnehmen, clearAuftrag } = useEinstellungenAuftrag();
  const geladen = !daten.laedt && daten.einsatz != null;

  // Erst räumen, wenn die Auswahl mit dem Auftrag eingehängt ist: vorher stünde die Sektion noch
  // im Laden, und der Auftrag wäre weg, bevor er wirkt.
  useEffect(() => {
    if (geladen && mitgliedAufnehmen) clearAuftrag();
  }, [geladen, mitgliedAufnehmen, clearAuftrag]);

  if (daten.laedt) return <SeitenSkeleton />;
  if (!daten.einsatz) {
    return <SeitenFehler text="Zugriff nicht ladbar" onWiederholen={daten.neuLaden} />;
  }
  const darfVerwalten = darfEinsatzLeiten(daten.einsatz);

  return (
    <>
      {daten.istAktiv && !darfVerwalten && (
        <div style={{ marginBottom: token.margin }}>
          <RechteHinweis sichtbar text={NUR_LEITUNG} />
        </div>
      )}
      <MitgliederAbschnitt
        key={einsatzId}
        einsatzId={einsatzId}
        darfVerwalten={darfVerwalten}
        darfFuehrungsstelleVerwalten={darfVerwalten}
        openAuswahl={mitgliedAufnehmen}
      />
    </>
  );
}
