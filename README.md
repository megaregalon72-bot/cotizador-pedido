# Cotizador de pedidos

Versión empresarial del cotizador existente, con Supabase, acceso por usuario y contraseña, clientes, almacenamiento automático y auditoría. Conserva los cálculos, las tarifas y el tipo de cambio editable.

Esta implementación está en `feat/supabase-cotizaciones`. La versión publicada no debe sustituirse hasta configurar y validar el proyecto real de Supabase.

## Configuración completa

Lee [GUIA_SUPABASE.md](GUIA_SUPABASE.md): incluye creación del proyecto, SQL y RLS, primer administrador, usuarios sin correos personales, configuración privada del servidor, pruebas y publicación en GitHub Pages.

Para preparar el proyecto:

```bash
npm ci
```

Copia `.env.example` como `.env`, completa únicamente la URL y la clave pública de Supabase, ejecuta la migración SQL, despliega `admin-users` y crea el primer administrador siguiendo la guía. Nunca pongas `service_role`, claves secretas o contraseñas de base de datos en `VITE_*`.

```bash
npm run dev
```

Esta versión usa Vite; el `index.html` fuente ya no se abre con doble clic. Para producción:

```bash
npm run build
npm run preview
```

## Funciones

- Acceso por nombre de usuario y contraseña; cuentas creadas solo por administradores.
- Administrador: usuarios, roles, activación, contraseña, todas las cotizaciones, auditoría y estadísticas.
- Vendedor: cliente, cotizador y consulta de sus propias cotizaciones.
- Guardado automático de pedidos completos, ID estable, reintentos sin duplicados y control de revisiones.
- Historial con cambio e importes originales, productos, exenciones, cliente, peso, envío y estado.
- Búsquedas por cliente, usuario y número, filtros de fechas/estado, orden, paginación y CSV.
- Auditoría protegida con valores anteriores y nuevos; fechas y horas de Panamá.
- Footer discreto: © año automático Erick Gonzalez · Todos los derechos reservados.

Los permisos se comprueban en PostgreSQL y la función de servidor, no solo en la interfaz. Desactivar una cuenta bloquea las operaciones incluso con una sesión antigua.

## Matemáticas conservadas

| Peso | Envío USD | CRC con cambio 500 | CRC con cambio 600 |
|---|---:|---:|---:|
| 0–10 kg, inclusive | $15.00 | ₡7,500 | ₡9,000 |
| Más de 10–20 kg, inclusive | $30.00 | ₡15,000 | ₡18,000 |
| Más de 20 kg | $40.00 | ₡20,000 | ₡24,000 |

Por ejemplo, $10 × 2 y 5 kg dan $35.00; con cambio 500 son ₡17,500 y con 600 son ₡21,000. El cambio admite hasta 2 decimales, se recuerda en el navegador y permanece fijado en cada cotización almacenada. Los importes se calculan y serializan como centavos enteros, sin perder precisión en JSON.

El IVA sigue sin tasa comercial definida. Las exenciones se registran y no añaden recargos. No se cambian los precios finales existentes.

## Pruebas

```bash
npm test
npm run check:functions
npx playwright install chromium
npm run test:ui
```

Las pruebas de base de datos ejecutan SQL y RLS en PostgreSQL local con PGlite. Las pruebas de interfaz y de administración usan un servicio de prueba controlado. No sustituyen la validación de Supabase Auth, la Edge Function y las cuentas en tu proyecto real.

Consulta [VERIFICACION.txt](VERIFICACION.txt) para conocer las comprobaciones ejecutadas y sus límites.

## Publicación

Configura las variables públicas de Actions y Source = GitHub Actions en Pages. El workflow prueba y publica `dist`, con archivos que llevan hash para evitar caché antigua. Los pasos exactos están en la guía. Un build local o un push a la rama de trabajo no confirman una publicación.

## Estructura

- `index.html`, `style.css`, `script.js`: interfaz y motor del cotizador original ampliados.
- `src/`: integración, sesiones, historial, administración, guardado y exportación.
- `supabase/migrations/`: tablas, funciones, RLS y auditoría.
- `supabase/functions/`: administración segura y nombres de usuario técnicos.
- `scripts/bootstrap-admin.mjs`: primer administrador desde un proceso privado.
- `tests/`: regresiones de cálculos, PostgreSQL, seguridad y navegador.
- `.env.example`: configuración pública sin secretos.

La guía HTML anterior se conserva como referencia histórica y no describe la instalación de esta versión.
