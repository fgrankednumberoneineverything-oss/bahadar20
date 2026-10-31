package com.example.hesabdar.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

@Composable
fun SplashScreen(onFinished: () -> Unit) {
    val logoAlpha = remember { Animatable(0f) }
    val logoScale = remember { Animatable(0.3f) }
    val counterA = remember { Animatable(0f) }
    val counter = remember { Animatable(0f) }
    val exit = remember { Animatable(1f) }

    LaunchedEffect(Unit) {
        launch { logoAlpha.animateTo(1f, tween(500)) }
        launch { logoScale.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow)) }
        launch { delay(1500); counterA.animateTo(1f, tween(700)) }
        launch { delay(1300); counter.animateTo(1f, tween(1800, easing = FastOutSlowInEasing)) }
        delay(4200)
        exit.animateTo(0f, tween(400))
        onFinished()
    }

    val inf = rememberInfiniteTransition(label = "splash")
    val glow by inf.animateFloat(
        0.85f, 1.15f, infiniteRepeatable(tween(2000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "glow"
    )
    val twinkle by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(3000, easing = LinearEasing)), label = "tw")
    val stars = remember { val r = Random(7); List(22) { Triple(r.nextFloat(), r.nextFloat(), r.nextFloat()) } }

    Box(
        Modifier.fillMaxSize().alpha(exit.value)
            .background(Brush.verticalGradient(listOf(Navy, Color(0xFF0A3A4A), Teal))),
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.fillMaxSize()) {
            stars.forEach { (x, y, ph) ->
                val a = (sin(2 * PI * (twinkle + ph)).toFloat() * 0.5f + 0.5f) * 0.8f
                drawCircle(Color.White.copy(alpha = a), 2.2f + ph * 2f, Offset(x * size.width, y * size.height))
            }
            drawCircle(
                Brush.radialGradient(listOf(Color(0x5526D0CE), Color.Transparent), center = center, radius = 320f * glow),
                radius = 320f * glow, center = center.copy(y = center.y - 60f)
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandBlock(
                Modifier.graphicsLayer {
                    scaleX = logoScale.value; scaleY = logoScale.value; alpha = logoAlpha.value
                }
            )
            Spacer(Modifier.height(20.dp))
            Text(
                toPersian((counter.value * 1_250_000).toLong()) + " تومان",
                modifier = Modifier.alpha(counterA.value),
                color = AppBrand.gold, fontSize = 20.sp, fontWeight = FontWeight.Bold
            )
        }
    }
}

private fun toPersian(n: Long): String =
    NumberFormat.getInstance(Locale.US).format(n).replace(',', '٬')
        .map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")
