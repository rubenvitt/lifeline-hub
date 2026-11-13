/**
 * Die Zeile, zu der der Sendestatus im Kopf springt (`etb/EtbSendestatus.tsx`, kwc2yszv D7): die
 * erste abgelehnte, sonst die erste ausstehende. Abgelehnt gewinnt wie in `pufferZustand`: ein
 * abgelehnter Eintrag verlangt eine Handlung, ein ausstehender nur Geduld — die Marke „1 abgelehnt ·
 * 2 ausstehend“ führt dorthin, wo zu handeln ist, nicht zur ersten Zeile im Dokument.
 */
export function vorgemerkteZeile(wurzel: ParentNode): HTMLElement | null {
  return (
    wurzel.querySelector<HTMLElement>('[data-zeile^="abgelehnt-"]') ??
    wurzel.querySelector<HTMLElement>('[data-zeile^="ausstehend-"]')
  );
}
