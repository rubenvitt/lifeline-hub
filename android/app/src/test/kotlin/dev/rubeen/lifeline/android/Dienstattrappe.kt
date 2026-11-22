package dev.rubeen.lifeline.android

import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Huellendienste
import dev.rubeen.lifeline.kern.Meldungsfreigabe

/** Dienste der Brücke für Tests, die sie nicht ansehen: nichts davon erreicht das System. */
class Dienstattrappe : Huellendienste {
    override val isHaptikEnabled: Boolean = false

    override fun play(feedback: Haptik.Feedback) = Unit

    override suspend fun loadMeldungsfreigabe(): Meldungsfreigabe = Meldungsfreigabe.VERWEIGERT

    override suspend fun requestMeldungsfreigabe(): Boolean = false

    override suspend fun showNotification(title: String, body: String?) = Unit

    override suspend fun print(): Boolean = false

    override fun startAnmeldung() = Unit

    override suspend fun saveDownload(name: String, bytes: ByteArray) = Unit
}
