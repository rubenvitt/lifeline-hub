package dev.rubeen.lifeline.android.dienste

import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Huellendienste
import dev.rubeen.lifeline.kern.Meldungsfreigabe

/**
 * Dienste der Brücke, bis die Systemdienste (Haptik, Meldung, Druck, Downloads, Anmeldung im
 * Browser) da sind: nichts davon richtet Schaden an. Haptik schweigt, Meldungen gelten als
 * ausgeschaltet, Drucken meldet „nicht gedruckt“, ein Download verfällt, und „Im Browser
 * anmelden“ lehnt die Seite mit einer Meldung ab.
 */
object Platzhalterdienste : Huellendienste {
    override val isHaptikEnabled: Boolean = false

    override fun play(feedback: Haptik.Feedback) = Unit

    override suspend fun loadMeldungsfreigabe(): Meldungsfreigabe = Meldungsfreigabe.VERWEIGERT

    override suspend fun requestMeldungsfreigabe(): Boolean = false

    override suspend fun showNotification(title: String, body: String?) = Unit

    override suspend fun print(): Boolean = false

    override fun startAnmeldung() {
        throw IllegalStateException("Im Browser anmelden ist in dieser Version noch nicht verfügbar.")
    }

    override suspend fun saveDownload(name: String, bytes: ByteArray) = Unit
}
