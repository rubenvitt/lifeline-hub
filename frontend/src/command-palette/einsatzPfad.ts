/** Liest die Einsatz-ID aus `/einsaetze/:id/...`; null außerhalb eines Einsatz-Workspaces. */
export function einsatzIdAusPfad(pathname: string): number | null {
  const teile = pathname.split('/').filter(Boolean); // z. B. ['einsaetze','5','etb']
  if (teile[0] !== 'einsaetze' || teile.length < 2) return null;
  const n = Number(teile[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
