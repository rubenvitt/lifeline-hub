package dev.rubeen.lifeline.helfer

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.helfer.dienste.Mitteilungen
import dev.rubeen.lifeline.helferkern.Auftraege
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Mitteilung eines neuen Auftrags (ADR-0111, Pager LLH-2157): Kanal „Aufträge“ mit hoher
 * Wichtigkeit, Pagerton über die Weckerlautstärke und Vibration, Dauerton und Vollbild, auf dem
 * Sperrbildschirm nur „Neuer Auftrag“.
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

    @Test
    fun `der Kanal klingelt mit dem Pagerton ueber die Weckerlautstaerke, der alte faellt weg`() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            android.app.NotificationChannel("auftraege", "alt", NotificationManager.IMPORTANCE_HIGH),
        )
        Mitteilungen.legeKanalAn(context)
        val kanal = manager.getNotificationChannel(Mitteilungen.KANAL)
        assertEquals("auftraege-pager", kanal.id)
        assertTrue(kanal.sound.toString().endsWith("/${R.raw.pagerton}"))
        assertEquals(AudioAttributes.USAGE_ALARM, kanal.audioAttributes.usage)
        assertTrue(kanal.vibrationPattern.size > 4)
        assertNull("alter Kanal ohne Pagerton ist weg", manager.getNotificationChannel("auftraege"))
    }

    @Test
    fun `ein neuer Auftrag klingelt dauernd und bringt das Vollbild`() {
        val auftrag = Beispiel.auftraege.first { it.id == Beispiel.OFFEN }
        val mitteilung = Mitteilungen.baue(context, auftrag)
        assertEquals(Notification.CATEGORY_ALARM, mitteilung.category)
        assertTrue(mitteilung.flags and Notification.FLAG_INSISTENT != 0)
        assertNotNull("Vollbild über dem Sperrbildschirm", mitteilung.fullScreenIntent)
    }

    @Test
    fun `still gesetzt klingelt sie nicht mehr und bringt kein Vollbild`() {
        val auftrag = Beispiel.auftraege.first { it.id == Beispiel.OFFEN }
        val mitteilung = Mitteilungen.baue(context, auftrag, klingeln = false)
        assertEquals(0, mitteilung.flags and Notification.FLAG_INSISTENT)
        assertTrue(mitteilung.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
        assertNull(mitteilung.fullScreenIntent)
    }

    @Test
    fun `eine Erinnerung traegt das Praefix, auf dem Sperrbildschirm nur Erinnerung`() {
        val auftrag = Beispiel.auftraege.first { it.id == Beispiel.OFFEN }
        val mitteilung = Mitteilungen.baue(context, auftrag, erinnerung = 1)
        val titel = mitteilung.extras.getCharSequence(Notification.EXTRA_TITLE).toString()
        assertTrue(titel, titel.startsWith(Auftraege.ERINNERUNG))
        assertEquals(
            Auftraege.ERINNERUNG_OEFFENTLICH,
            mitteilung.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString(),
        )
    }
}
