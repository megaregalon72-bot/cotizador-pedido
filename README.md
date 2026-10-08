# Cotizador de pedidos

Aplicación local en HTML, CSS y JavaScript para precotizar productos y envío. Abre `index.html` con doble clic. Mantén `style.css` y `script.js` en la misma carpeta. No necesita servidor, Node.js ni instalación de dependencias.

## Uso de la aplicación

En la parte superior, modifica **Tipo de cambio · colones por dólar**: escribe `600` para usar **$1 = ₡600**, por ejemplo. Admite punto o coma y hasta 2 decimales, con valores mayores que cero y hasta 1,000,000. Todos los importes en colones y el resumen se actualizan de inmediato; los precios en dólares se mantienen. Un cambio vacío o inválido oculta la conversión y bloquea la copia hasta corregirlo.

El último cambio válido se recuerda en ese navegador, si permite almacenamiento local. **Limpiar cotización** conserva el tipo de cambio. En un navegador nuevo se usa `500`; si el almacenamiento está bloqueado, puedes modificarlo durante la sesión.

1. Escribe el precio unitario en dólares y la cantidad del producto.
2. Usa **+ Agregar producto** para cada precio diferente. Para unidades al mismo precio, cambia la cantidad.
3. Escribe el peso total en kilogramos. Se aplica automáticamente el envío.
4. Revisa el total en dólares y colones.
5. Presiona **Copiar resumen** y pega el texto en el chat de WhatsApp del cliente.
6. Usa **Limpiar cotización** para comenzar otro pedido. Restablece la línea inicial con precio vacío y cantidad 1, peso vacío y todos los importes en cero.

El cálculo se actualiza mientras escribes. Una línea recién agregada y todavía intacta no altera el pedido; si comienzas a llenarla, debes completarla o eliminarla. Los campos incorrectos se marcan y bloquean la copia del resumen. Sin peso, el total es parcial. Un peso escrito de **0 kg** sí aplica la tarifa de $15, conforme al rango 0–10 kg solicitado; un peso vacío mantiene el envío en cero.

Puedes escribir decimales con punto o coma: `8.5` o `8,5`. No escribas separadores de miles en los campos. Los precios admiten hasta 2 decimales; el peso, hasta 6; la cantidad debe ser un entero mayor que cero. El resumen siempre muestra dólares con 2 decimales y colones con separadores de miles. La app no guarda historial: copia el resumen antes de cerrar o recargar.

Si el navegador bloquea el portapapeles, la aplicación intenta una segunda ruta de copia. Si también falla, abre el resumen seleccionable para copiarlo manualmente.

## Tarifas y conversión

| Peso | Envío USD | Envío CRC |
|---|---:|---:|
| De 0 hasta 10 kg, inclusive | $15.00 | ₡7,500 |
| Más de 10 hasta 20 kg, inclusive | $30.00 | ₡15,000 |
| Más de 20 kg | $40.00 | ₡20,000 |

La tabla muestra la conversión inicial de **$1 USD = ₡500 CRC**. Puedes cambiarla desde la cabecera; con `600`, los envíos equivalen a ₡9,000, ₡18,000 y ₡24,000. Por ejemplo, 10.01 kg cae en la segunda tarifa y 20.01 kg, en la tercera. No hay huecos entre rangos. El total es subtotal de productos + envío. Las tarifas son finales y no reciben ningún recargo de IVA.

## Publicación gratuita: Visual Studio Code + GitHub + GitHub Pages

Estas instrucciones usan Windows y la carga de archivos desde la web de GitHub. No necesitas aprender comandos de Git. Un repositorio es la carpeta de tu proyecto en GitHub; GitHub Pages publica sus archivos como un sitio web. Guía revisada con documentación oficial el **7 de octubre de 2026**.

### 1. Crear la carpeta del proyecto

Descarga el ZIP y haz clic derecho → **Extraer todo**. Dentro encontrarás la carpeta `cotizador-pedidos`. Puedes moverla a Documentos o al Escritorio. Los tres archivos de la aplicación ya están creados.

Si prefieres copiar el código desde cero, crea una carpeta llamada `cotizador-pedidos`: clic derecho en el Escritorio → **Nuevo → Carpeta**. Descarga e instala [Visual Studio Code](https://code.visualstudio.com/). Abre VS Code y elige **File → Open Folder** (Archivo → Abrir carpeta). Selecciona tu carpeta.

### 2. Guardar los tres archivos

Si extrajiste el ZIP, confirma en la barra izquierda de VS Code que aparecen `index.html`, `style.css` y `script.js`. Abre cada uno para ver su código completo.

Si estás empezando con una carpeta vacía, haz clic derecho sobre la carpeta en el Explorador de VS Code y selecciona **New File** (Nuevo archivo). Crea `index.html`, pega el contenido completo del archivo entregado y guarda con **Ctrl+S**. Repite con `style.css` y `script.js`, usando el contenido correspondiente a cada archivo. Los nombres deben coincidir exactamente y los tres deben estar juntos, sin subcarpetas. Si los creaste en el Bloc de notas, revisa que no terminen en `.txt`.

### 3. Probar en tu computadora

Abre la carpeta con el Explorador de Windows y haz doble clic en `index.html`. Si Windows pregunta con qué programa abrirlo, elige Chrome, Edge o Firefox. Configura el cambio en `500`, e ingresa precio `10`, cantidad `2` y peso `5`. Debes obtener **$35.00 USD / ₡17,500 CRC**; cambia a `600` y verifica **$35.00 USD / ₡21,000 CRC**. Prueba **Copiar resumen** y pégalo en el Bloc de notas con Ctrl+V. Después presiona **Limpiar cotización** y revisa que los importes regresen a cero y el cambio se conserve. La aplicación no necesita Internet.

### 4. Crear una cuenta o iniciar sesión en GitHub

Visita [github.com](https://github.com/). Si ya tienes una cuenta, pulsa **Sign in** e inicia sesión. Si no tienes cuenta, pulsa **Sign up** y sigue el registro con tu correo, usuario y contraseña o las opciones disponibles en pantalla. Verifica el correo si se solicita. Guarda tu nombre de usuario: formará parte de la dirección pública del cotizador.

### 5. Crear el repositorio

Ya dentro de tu cuenta, abre [github.com/new](https://github.com/new). En **Repository name** escribe `cotizador-pedidos`. Selecciona **Public** para usar Pages con GitHub Free. Activa **Add README** para iniciar el repositorio y crear la rama principal. Pulsa **Create repository**. El nombre del repositorio del cotizador es `cotizador-pedidos`, aunque el enlace publicado también incluirá tu usuario.

### 6. Subir los archivos

En la pestaña **Code** del repositorio, pulsa **Add file → Upload files**. Pulsa **choose your files** y selecciona únicamente `index.html`, `style.css` y `script.js` de tu carpeta local. También puedes arrastrar los tres archivos sueltos a la zona de carga. No subas el ZIP ni la carpeta que los contiene: el objetivo es ver los tres archivos directamente en la raíz del repositorio.

Escribe un mensaje como `Agregar cotizador de pedidos`. Guarda los cambios en la rama principal (`main`) con **Commit changes**. Si la pantalla te ofrece crear otra rama y muestra **Propose changes**, puedes elegir guardar directamente en `main` para este repositorio personal. Si usas la otra rama, termina el proceso creando y fusionando su pull request. Vuelve a **Code** y confirma que los tres archivos estén listados junto al README.

### 7. Activar GitHub Pages

Abre **Settings** (Configuración) del repositorio. En la barra lateral, elige **Pages**. En **Build and deployment**, configura:

| Campo | Opción |
|---|---|
| Source | Deploy from a branch |
| Branch | main |
| Folder | /(root) |

Presiona **Save**. Esto indica que GitHub debe publicar los archivos que subiste directamente a `main`. Si tu rama principal tiene otro nombre, selecciona esa rama. Si no aparece ninguna rama, vuelve al paso 6 y confirma que los cambios sí se guardaron en el repositorio.

### 8. Obtener y comprobar el enlace público

La publicación puede tardar hasta unos 10 minutos. Regresa a **Settings → Pages** y busca el enlace del sitio o el botón **Visit site**. Tendrá una forma como `https://tuusuario.github.io/cotizador-pedidos/`, sustituyendo `tuusuario` por tu usuario real. Ese ejemplo no es una página que ya esté publicada: tu enlace aparecerá después de realizar estos pasos en tu cuenta.

Abre el enlace y comprueba el cálculo del paso 3. Abre también el mismo enlace desde tu celular. La dirección para compartir es la de `github.io`; la dirección de `github.com` muestra el repositorio y su código.

### 9. Compartir con los vendedores

Copia el enlace público de Pages y envíalo por WhatsApp. Cada vendedor podrá abrirlo desde el navegador del celular. Para tenerlo a mano, pueden guardarlo en favoritos o usar la opción del navegador para agregar el enlace a la pantalla de inicio. Cada cotización se calcula en el dispositivo del vendedor; no existe una bandeja compartida de pedidos.

### 10. Modificar y actualizar la página

Abre tu carpeta en VS Code, modifica el archivo correspondiente y guarda con **Ctrl+S**. Recarga la versión local de `index.html` y prueba el cambio. En GitHub, vuelve al repositorio, entra en **Add file → Upload files** y sube los archivos modificados con sus mismos nombres, directamente en la raíz. Guarda los cambios en `main` con un mensaje como `Actualizar tarifas`.

Pages publicará esos cambios automáticamente. Espera a que termine la publicación y recarga el enlace público. En computadora puedes usar **Ctrl+F5** si sigues viendo la versión anterior; en celular, vuelve a cargar la página. El enlace para los vendedores se mantiene igual mientras conserves el usuario y el nombre del repositorio. Editar sólo en VS Code no cambia el sitio publicado: también debes subir el archivo modificado.

## Si algo no aparece correctamente

| Situación | Qué revisar |
|---|---|
| Página sin diseño | `style.css` debe estar junto a `index.html`, con ese nombre exacto. |
| No realiza cálculos | `script.js` debe estar junto a `index.html`; permite JavaScript en tu navegador. |
| Error 404 en Pages | Espera la publicación; comprueba rama `main`, carpeta `/(root)` e `index.html` en la raíz. |
| No ves una actualización | Confirma que guardaste los cambios en GitHub y que la publicación terminó; después recarga. |
| No se activa Copiar resumen | Completa al menos un producto válido, el peso y cualquier campo marcado. |
| Se bloquea la copia automática | Usa el texto seleccionable que abre la aplicación. |

## Configuración del código

Al comienzo de `script.js` se encuentran las constantes:

- `DEFAULT_USD_TO_CRC`: cambio inicial por cada dólar; actualmente `500`. El usuario puede modificarlo en la cabecera sin editar código.
- `SHIPPING_RATES`: límite superior de cada rango y precio final en centavos. `1500n` equivale a $15.00. La última tarifa usa `maxKg: null`, que significa sin límite superior. Si cambias los límites, actualiza también sus textos `label`.
- `IVA_CONFIG.rateBasisPoints`: `null` significa tasa no definida. Para configurar una tasa confirmada comercialmente, escribe el porcentaje multiplicado por 100, como entero. La app muestra entonces el desglose del envío: precio sin IVA, IVA y precio con IVA. Se extrae del precio final; no altera el total comercial. No se asignó una tasa real.
- `LIMITS`: máximos admitidos por precio, cantidad y peso.

Los importes y el tipo de cambio se calculan en centavos enteros con BigInt; la conversión a colones se redondea al centavo más cercano. También se redondea un eventual desglose de IVA. En ese desglose, precio sin IVA + IVA coincide exactamente con el precio final. No se agrega IVA adicional a los precios de productos ingresados por el vendedor.

## Comprobaciones realizadas

Se ejecutaron las funciones reales de `script.js` en Node.js para comprobar los cálculos. Node.js se usó únicamente durante la revisión: la aplicación entregada no lo necesita.

| Caso solicitado | Subtotal USD | Envío USD | Total USD | Total CRC |
|---|---:|---:|---:|---:|
| $10 × 2; peso 5 kg | $20.00 | $15.00 | $35.00 | ₡17,500 |
| $20 × 2 + $5 × 3; peso 15 kg | $55.00 | $30.00 | $85.00 | ₡42,500 |
| $100 × 1; peso 25 kg | $100.00 | $40.00 | $140.00 | ₡70,000 |

También pasaron pruebas de fronteras de peso, decimales, cantidades inválidas, negativos, campos vacíos, centavos exactos y conservación del importe al desglosar un IVA de prueba. Consulta `VERIFICACION.txt` para conocer el alcance.

**Versión con cambio editable, 8 de octubre de 2026:** se comprobó la interfaz en Chromium mediante HTTP local: actualización de todas las conversiones y tarifas, portapapeles y resumen manual, conservación del cambio al recargar y limpiar, decimales, valores inválidos, preferencias corruptas y almacenamiento bloqueado. Se verificó que no hubiera desbordamiento horizontal en 320, 360, 390, 414, 430, 760 y 1280 px, y se revisaron capturas de móvil y escritorio. La apertura directa mediante `file://` no pudo comprobarse porque la política del navegador de este entorno bloquea esas direcciones. Estas pruebas no confirman una publicación nueva en GitHub Pages.

## Fuentes oficiales de la guía

- [Creación de una cuenta de GitHub](https://docs.github.com/en/account-and-profile/how-tos/account-management/creating-an-account-on-github)
- [Creación de un sitio de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [Carga de archivos a un repositorio](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [Configuración del origen de publicación](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Editor de Visual Studio Code](https://code.visualstudio.com/docs/getstarted/userinterface)
