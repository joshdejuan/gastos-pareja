# Gastos

App web minimalista para llevar los gastos e ingresos en común de una pareja. Se puede instalar en el móvil.

**App:** https://joshdejuan.github.io/gastos-pareja/

**Coste: 0 €.** Usa GitHub Pages (web) y el plan gratuito de Supabase (base de datos y login, proyecto `gastos-pareja`).

## Qué hace

- **Hogar compartido:** cada uno tiene su cuenta y se une con un código de invitación.
- **Gastos e ingresos en común:** con categoría, fecha y quién lo añadió.
- **Tiempo real:** lo que añade uno aparece al instante en el móvil del otro (indicador "en directo").
- **Presupuestos mensuales por categoría:**
  - Una barra muestra cuánto lleváis, con una marca de lo que tocaría llevar a día de hoy.
  - Avisa con "Casi agotado" a partir del 90 % y si os pasáis.
- **Resumen del mes:** ingresos, gastos, ahorro y gráfico por categoría. Toca una categoría para ver sus movimientos.
- **Evolución de 12 meses** (ingresos frente a gastos). Toca un mes para ir a él. Incluye comparativas automáticas: total frente al mes anterior y categorías que suben o bajan respecto a la media de los 3 meses anteriores.
- **Búsqueda** en todos los meses y filtro por categoría.
- **Movimientos periódicos:**
  - Frecuencias: cada semana, cada 2 semanas, cada mes, cada 2, 3 o 6 meses, cada año, o una frecuencia personalizada.
  - Pueden no terminar nunca, acabar en una fecha o repetirse un número de veces, y al crearlos se ven las próximas fechas.
  - En Ajustes se pueden editar, pausar o eliminar.
- **Entrar con Face ID o huella** (passkeys, función en beta de Supabase).
- **Categorías editables** (nombre, color, presupuesto), exportación a CSV y modo oscuro.

**Instalar en el móvil:** abre la dirección y elige "Añadir a pantalla de inicio" (iPhone: botón Compartir; Android: menú ⋮).

## Seguridad

- **Datos aislados por hogar:** las reglas RLS de PostgreSQL filtran cada consulta en la propia base de datos, así que nadie de fuera ve ni toca vuestros datos.
- **Sin acceso anónimo:** los usuarios sin sesión no pueden leer ninguna tabla. Los hogares solo se crean y se unen mediante funciones que validan cada paso, con un máximo de 2 personas.
- **Contraseñas:** las gestiona Supabase Auth (con hash bcrypt), y la app exige al menos 10 caracteres.
- **Protección en el navegador:** la web bloquea scripts externos con una política CSP, nunca inserta HTML con datos de usuario y todo va por HTTPS.
- **Cerrar registros:** cuando tengáis las dos cuentas, desactivad los registros nuevos en Supabase → Authentication → Sign In / Providers → *Allow new users to sign up*.

## Mantenimiento

- **Pausa por inactividad:** Supabase pausa los proyectos gratuitos que pasan 7 días sin actividad. La tarea `.github/workflows/keepalive.yml` lo evita y además genera los periódicos.
- **Generación interna:** Supabase también genera los periódicos 4 veces al día con `pg_cron`.
- **Copias de seguridad:** cada domingo se guarda automáticamente una copia completa en Google Drive, en la carpeta "Copias de seguridad · Gastos en pareja".
- **Face ID / huella:** requiere activar Passkeys en Supabase → Authentication → Passkeys, con:
  - RP ID: `joshdejuan.github.io`
  - Origen: `https://joshdejuan.github.io`
  - Nombre: `Gastos`

## Estructura

```
index.html, app.js, styles.css   la app
config.js                        dirección y clave pública de Supabase
sw.js, manifest.webmanifest      modo app instalable
supabase/schema.sql, v3.sql      tablas, seguridad y funciones
```
