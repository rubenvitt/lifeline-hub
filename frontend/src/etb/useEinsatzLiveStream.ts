import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * EINE SSE-Verbindung für den gesamten Einsatz-Live-Feed.
 *
 * Der Backend-`LiveHub` multiplext ALLE Event-Typen (uhs, person, schaden, einheit,
 * fahrzeug, abschnitt, lage_zone, …) auf EINEN broadcast-Kanal pro Einsatz; jede
 * `…/stream`-Route leitet den kompletten Kanal verbatim weiter. Deshalb genügt EINE
 * Verbindung (`/etb/stream` als kanonischer Einsatz-Feed); client-seitig wird nach
 * Event-Name auf die betroffenen Query-Keys verteilt.
 *
 * WICHTIG (Grund für die Konsolidierung): Pro Domäne eine eigene `EventSource` zu
 * öffnen, sprengt das HTTP/1.1-Limit von 6 Verbindungen je Origin. Sind alle 6 von
 * langlebigen SSE belegt, hängt JEDER weitere Request (z. B. ein POST zum Anlegen
 * einer Zone) endlos — die Mutation persistiert nie und die Karte aktualisiert nicht.
 * Diese eine Verbindung hält die Lagekarte sicher unter dem Limit.
 */
export function useEinsatzLiveStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/etb/stream`);
    const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });

    const onUhs = () => inval('einsatz-uhs');
    const onSchaden = () => inval('einsatz-schaeden');
    const onFahrzeug = () => inval('einsatz-fahrzeuge');
    const onMaterial = () => inval('einsatz-material');
    const onZone = () => { inval('einsatz-zonen'); inval('gefahrengebiete'); };
    const onGefahr = () => { inval('gefahrenmatrix'); inval('gefahrengebiete'); };
    const onEinheit = () => {
      inval('einsatz-einheiten');
      inval('einsatz-fuehrungskraefte');
      // Mitglieder-Zuordnungen an Einheiten betreffen auch Personal- und Material-Listen.
      inval('einsatz-personal');
      inval('einsatz-fahrzeuge');
      inval('einsatz-material');
    };
    const onAbschnitt = () => {
      inval('einsatz-abschnitte');
      inval('einsatz-fuehrungskraefte');
    };
    // person berührt mehrere Sammlungen: Registrierung, Einheiten-/Abschnittsführung,
    // sowie disponiertes Personal im Meldebild.
    const onPerson = () => {
      inval('einsatz-personen');
      inval('einsatz-personal');
      inval('einsatz-einheiten');
      inval('einsatz-abschnitte');
      inval('einsatz-fuehrungskraefte');
    };
    const onLagebericht = () => {
      inval('einsatz-lageberichte');
      inval('einsatz-lagebericht');
    };
    const onChat = () => {
      inval('einsatz-chat-kanaele');
      inval('einsatz-chat-nachrichten');
    };
    const onErinnerung = () => inval('einsatz-erinnerungen');
    const onAuftrag = () => inval('einsatz-auftraege');
    // Buffer-Overflow (verpasste Events) → konservativ alles refetchen.
    const onLag = () => {
      onUhs();
      onSchaden();
      onFahrzeug();
      onMaterial();
      onZone();
      onGefahr();
      onEinheit();
      onAbschnitt();
      onPerson();
      onLagebericht();
      onChat();
      onErinnerung();
      onAuftrag();
    };

    quelle.addEventListener('uhs', onUhs);
    quelle.addEventListener('schaden', onSchaden);
    quelle.addEventListener('fahrzeug', onFahrzeug);
    quelle.addEventListener('material', onMaterial);
    quelle.addEventListener('lage_zone', onZone);
    quelle.addEventListener('gefahr', onGefahr);
    quelle.addEventListener('einheit', onEinheit);
    quelle.addEventListener('abschnitt', onAbschnitt);
    quelle.addEventListener('person', onPerson);
    quelle.addEventListener('lagebericht', onLagebericht);
    quelle.addEventListener('chat', onChat);
    quelle.addEventListener('erinnerung', onErinnerung);
    quelle.addEventListener('auftrag', onAuftrag);
    quelle.addEventListener('lagged', onLag);
    return () => {
      quelle.removeEventListener('uhs', onUhs);
      quelle.removeEventListener('schaden', onSchaden);
      quelle.removeEventListener('fahrzeug', onFahrzeug);
      quelle.removeEventListener('material', onMaterial);
      quelle.removeEventListener('lage_zone', onZone);
      quelle.removeEventListener('gefahr', onGefahr);
      quelle.removeEventListener('einheit', onEinheit);
      quelle.removeEventListener('abschnitt', onAbschnitt);
      quelle.removeEventListener('person', onPerson);
      quelle.removeEventListener('lagebericht', onLagebericht);
      quelle.removeEventListener('chat', onChat);
      quelle.removeEventListener('erinnerung', onErinnerung);
      quelle.removeEventListener('auftrag', onAuftrag);
      quelle.removeEventListener('lagged', onLag);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
