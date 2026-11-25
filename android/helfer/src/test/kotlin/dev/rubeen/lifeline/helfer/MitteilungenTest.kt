package dev.rubeen.lifeline.helfer

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.helfer.dienste.Mitteilungen
import dev.rubeen.lifeline.helferkern.Auftraege
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Mitteilung eines neuen Auftrags (ADR-0106): Kanal „Aufträge“ mit hoher Wichtigkeit und
 * Vibration, auf dem Sperrbildschirm nur „Neuer Auftrag“.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class MitteilungenTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `der Kanal Auftraege ist wichtig und vibriert, privat auf dem Sperrbildschirm`() {
        Mitteilungen.legeKanalAn(context)
        val kanal = context.getSystemService(NotificationManager::class.java).getNotificationChannel(Mitteilungen.KANAL)
        assertNotNull(kanal)
        assertEquals(Auftraege.KANAL, kanal.name)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, kanal.importance)
        assertTrue(kanal.shouldVibrate())
        assertEquals(Notification.VISIBILITY_PRIVATE, kanal.lockscreenVisibility)
    }

    @Test
    fun `ein neuer Auftrag zeigt auf dem Sperrbildschirm nur Neuer Auftrag`() {
        val auftrag = Beispiel.auftraege.first { it.id == Beispiel.OFFEN }
        val mitteilung = Mitteilungen.baue(context, auftrag)
        assertEquals(Mitteilungen.KANAL, mitteilung.channelId)
        assertEquals(Notification.VISIBILITY_PRIVATE, mitteilung.visibility)
        val oeffentlich = mitteilung.publicVersion
        assertNotNull(oeffentlich)
        assertEquals(Auftraege.MITTEILUNG_OEFFENTLICH, oeffentlich.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(auftrag.text, mitteilung.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertNotNull("Tippen öffnet das Detail", mitteilung.contentIntent)
    }
}
