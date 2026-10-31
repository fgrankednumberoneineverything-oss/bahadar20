package com.example.hesabdar.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

private val Gold = Color(0xFFFFC93C)
private val GoldDark = Color(0xFFB8860B)
internal val Navy = Color(0xFF0B1F3A)
internal val Teal = Color(0xFF0E7C8C)

@Composable
fun AnimatedLogo(modifier: Modifier = Modifier) {
    val bar1 = remember { Animatable(0f) }
    val bar2 = remember { Animatable(0f) }
    val bar3 = remember { Animatable(0f) }
    val chim = remember { Animatable(0f) }
    val coin = remember { Animatable(0f) }
    val smokeOn = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        val ease = tween<Float>(700, easing = FastOutSlowInEasing)
        launch { bar1.animateTo(1f, ease) }
        launch { delay(150); bar2.animateTo(1f, ease) }
        launch { delay(300); bar3.animateTo(1f, ease) }
        launch { delay(450); chim.animateTo(1f, ease) }
        launch { delay(700); smokeOn.animateTo(1f, tween(600)) }
        launch { delay(900); coin.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow)) }
    }

    val inf = rememberInfiniteTransition(label = "logo")
    val t by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(3200, easing = LinearEasing)), label = "smoke")
    val bob by inf.animateFloat(
        -1f, 1f, infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bob"
    )

    Canvas(modifier) {
        val u = size.minDimension / 108f
        val baseY = 84f

        drawRoundRect(
            Brush.linearGradient(listOf(Navy, Teal), Offset.Zero, Offset(size.width, size.height)),
            cornerRadius = CornerRadius(26 * u)
        )

        fun bar(x: Float, w: Float, h: Float, p: Float) {
            val top = baseY - h * p
            drawRoundRect(
                Brush.verticalGradient(listOf(Color.White, Color(0xFF7FE7F2)), startY = top * u, endY = baseY * u),
                Offset(x * u, top * u), Size(w * u, h * p * u), CornerRadius(2 * u)
            )
        }
        bar(30f, 10f, 18f, bar1.value)
        bar(44f, 10f, 28f, bar2.value)
        bar(58f, 10f, 36f, bar3.value)

        val chH = 44f * chim.value
        drawRect(Color(0xFFE8F9FC), Offset(72 * u, (baseY - chH) * u), Size(8 * u, chH * u))
        if (chim.value > 0.95f) {
            drawRoundRect(Gold, Offset(70 * u, (baseY - 48f) * u), Size(12 * u, 4 * u), CornerRadius(1 * u))
        }

        drawRoundRect(Gold, Offset(24 * u, 84 * u), Size(62 * u * bar1.value, 4 * u), CornerRadius(2 * u))

        if (coin.value > 0f) {
            drawCoin(Offset(34 * u, (52f + bob * 2f) * u), 7 * u * coin.value, u)
        }

        val chimneyTop = baseY - 48f
        for (i in 0 until 4) {
            val p = (t + i / 4f) % 1f
            val x = (76f + sin(p * 2 * PI * 1.5 + i).toFloat() * 4f) * u
            val y = (chimneyTop - p * 34f) * u
            val r = (3f + p * 5f) * u
            val toGold = ((p - 0.55f) / 0.3f).coerceIn(0f, 1f)
            val a = (1f - p * 0.35f) * smokeOn.value * (p * 6f).coerceAtMost(1f)
            if (toGold < 0.05f) drawCircle(Color.White.copy(alpha = 0.55f * a), r, Offset(x, y))
            else drawCoin(Offset(x, y), r, u, alpha = a, mix = toGold)
        }
    }
}

private fun DrawScope.drawCoin(c: Offset, r: Float, u: Float, alpha: Float = 1f, mix: Float = 1f) {
    drawCircle(lerp(Color.White, Gold, mix).copy(alpha = alpha), r, c)
    drawCircle(GoldDark.copy(alpha = alpha * mix), r * 0.62f, c, style = Stroke(1.1f * u))
}
