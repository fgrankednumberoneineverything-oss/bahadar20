راهنما
1) پوشه res را داخل app/src/main/ ادغام (merge) کنید.
2) فایل‌های پوشه kotlin را داخل app/src/main/java/com/example/hesabdar/ui/ کپی کنید
   (اگر پکیج شما فرق دارد، خط اول هر فایل را اصلاح کنید).
3) AndroidManifest-snippet.xml را در مانیفست اعمال کنید:
   - آیکون: @mipmap/ic_launcher
   - متن زیر آیکون روی گوشی: @string/app_label (خالی است)
4) MainActivity-snippet.kt را در onCreate قرار دهید.
5) وابستگی لازم در build.gradle:
   implementation("androidx.compose.material:material-icons-extended")
نام داخل برنامه: در AppBrand.kt و strings.xml (app_name) عوض می‌شود.
