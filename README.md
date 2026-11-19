# Gastos

App web minimalista para llevar los gastos e ingresos en común de una pareja. Se puede instalar en el móvil.

**App:** https://joshdejuan.github.io/gastos-pareja/

**Coste: 0 €.** Usa GitHub Pages (web) y el plan gratuito de Supabase (base de datos y login, proyecto `gastos-pareja`).

## Qué hace

- **Hogar compartido:** cada uno tiene su cuenta (email y contraseña). Una persona crea el hogar y la otra se une con el código de invitación.
- **Gastos e ingresos en común:** con concepto, categoría y fecha. Se ve quién añadió cada movimiento.
- **Resumen del mes:** ingresos, gastos y ahorro, con un gráfico de gastos por categoría.
- **Categorías editables:** las de gastos y las de ingresos por separado. Se pueden crear, renombrar, cambiar de color y quitar; los movimientos antiguos conservan la suya.
- **Movimientos periódicos** (semanales, mensuales o anuales): se crean solos en su fecha y se pueden pausar o eliminar en Ajustes.
- **Editar o borrar:** tocando cualquier movimiento de la lista.
- **Exportar:** cada mes, a CSV.
- **Modo oscuro** automático.

**Instalar en el móvil:** abre la dirección y elige "Añadir a pantalla de inicio" (iPhone: botón Compartir; Android: menú ⋮).

## Seguridad

- **Datos aislados por hogar:** las reglas RLS de PostgreSQL filtran cada consulta en la propia base de datos, así que nadie de fuera ve ni toca vuestros datos.
- **Sin acceso anónimo:** los usuarios sin sesión no pueden leer ninguna tabla. Los hogares solo se crean y se unen mediante funciones que validan cada paso, con un máximo de 2 personas.
- **Contraseñas:** las gestiona Supabase Auth (con hash bcrypt), y la app exige al menos 10 caracteres.
- **Protección en el navegador:** la web bloquea scripts externos con una política CSP, nunca inserta HTML con datos de usuario y todo va por HTTPS.
- **Cerrar registros:** cuando tengáis las dos cuentas, desactivad los registros nuevos en Supabase → Authentication → Sign In / Providers → *Allow new users to sign up*.

## Mantenimiento

- **Pausa por inactividad:** Supabase pausa los proyectos gratuitos que pasan 7 días sin actividad. La tarea `.github/workflows/keepalive.yml` lo evita y además genera los periódicos. Necesita los secretos `SUPABASE_URL` y `SUPABASE_ANON_KEY` en *Settings → Secrets and variables → Actions*, con los valores de `config.js`.
- **Generación interna:** Supabase también genera los periódicos 4 veces al día con `pg_cron`.
- **Copias de seguridad:** el plan gratuito no las incluye. Exportad el CSV de vez en cuando.

## Estructura

```
index.html, app.js, styles.css   la app
config.js                        dirección y clave pública de Supabase
sw.js, manifest.webmanifest      modo app instalable
supabase/schema.sql              tablas, seguridad y funciones
```
