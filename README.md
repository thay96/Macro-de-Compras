# Gestión de Compras · Conequipos

Reconstrucción web del Excel con macros `MACRO DE COMPRAS 2021 (ENTREGA)`.
Este documento explica **cómo funcionaba el Excel**, **qué se hizo para mejorarlo** y **cómo está armado el sistema nuevo**, para que otra persona o IA pueda continuar el trabajo sin contexto previo.

- Stack: HTML + CSS + JavaScript puro (sin Tailwind ni frameworks) · Supabase (base de datos) · Cloudflare Pages (hosting).
- Sin login: la usa la señora de compras abriendo el enlace.
- Un solo ítem por orden de compra (una cotización = un producto).

---

## 1. Cómo funcionaba el Excel

Pestañas del libro y qué se hizo con cada una:

| Pestaña original | Para qué servía | En el sistema nuevo |
|---|---|---|
| Bd Clasificación | Lista de tipos de producto y unidades | **Se ignora.** Los tipos salen de los productos que crea la señora |
| Bd Productos | Lista de productos (estaba sucia, ej. "Allanadora" medida en galones) | **Se ignora.** Productos desde cero (pestaña Productos) |
| Bd Proveedor | 208 proveedores con teléfono, dirección, NIT, ciudad, email y representante | **Se migra** a `com_proveedores` (CSV limpio, sin duplicados) |
| Hoja2 | Datos de apoyo del formulario (donde el macro guardaba cada cotización) | Se ignora |
| Base de Datos Ordenes de Compra | Lo que la señora consulta: una fila por orden con los datos del ganador | Pestaña **Órdenes de compra** (vista `com_base_ordenes`) |
| INICIAL | Pantalla con 3 botones: Cotización y Selección, Orden de Compra, Evaluación de Proveedores | Pestaña **Nueva cotización** |
| Selección | Hoja de apoyo | Se ignora |
| oc vigente | Formato de la orden de compra (código 08F-03) que se llena solo y se saca en PDF | Hoja de orden en la app, con PDF |
| Evaluacion de Proveedores | Evaluación posterior de proveedores | Se ignora (fuera de alcance) |

### Flujo del usuario en el Excel

1. Botón **Cotización y Selección** abre un formulario (UserForm de VBA): tipo de producto, producto, descripción (texto libre), unidad de medida, cantidad.
2. Se llenan hasta **3 proveedores**: nombre (trae teléfono y dirección), precio y 5 calificaciones.
3. Botón **Calcular**: suma los puntos de cada proveedor; gana el de más puntos.
4. Botón **Guardar**: guarda **solo al proveedor ganador** (los otros dos se descartan) en la base de datos.
5. Pregunta "¿Generar orden de compra?"; si dice Sí, llena la hoja `oc vigente` automáticamente (consecutivo, datos del proveedor, fechas, ítem, IVA 19 %, total) y se descarga en PDF.

### Reglas de puntaje (sacadas del código VBA, módulo del formulario)

Cada proveedor suma de 1 a 3 puntos por criterio. Máximo **15**.

| Criterio | 3 puntos | 2 puntos | 1 punto |
|---|---|---|---|
| Condiciones comerciales | Contado | 8 a 30 días | Más de 30 días |
| Precio | Más económico | Precio promedio | Más costoso |
| Oportunidad en la entrega | Cumplido | Poco cumplido | Incumplido |
| Calidad del insumo/servicio | Muy confiable | Poco confiable | No es confiable |
| Garantía (solo si dice SÍ) | Más días que los demás | En medio o empate | Menos días que los demás |

Garantía = **NO → 0 puntos**. Con garantía SÍ se comparan los **días de garantía** de los proveedores entre sí. (El usuario había dicho "SÍ = 2, NO = 0", pero el código real compara días; se respetó el código.)

Notas del Excel original:
- La calificación del **precio se elegía a mano**, aunque ya se habían escrito los precios.
- El IVA estaba fijo en 19 % en la hoja `oc vigente`.
- El archivo era `.xlsm` con ActiveX; se rompía por bloqueo de macros y controles de otro equipo, por eso se decidió reconstruirlo.

---

## 2. Qué se mejoró en el sistema nuevo

- **Precio automático:** al escribir los precios, el sistema califica solo (más barato 3, medio 2, más caro 1; todos iguales = 2; con 2 proveedores: 3 y 1).
- **Puntos en vivo:** ya no hace falta pulsar Calcular (el botón se dejó por costumbre). El ganador se marca solo.
- **Desempate:** si hay empate en puntos gana el de menor precio (el Excel no lo definía).
- **Mínimo 2 proveedores** (el tercero es opcional).
- **Se guardan los 3 proveedores** de cada cotización (tabla hija) y se marca al ganador, como respaldo de auditoría. La señora **solo ve** al ganador en su lista, igual que antes.
- **Productos desde cero**, con botón **+ Nuevo producto** y papelera (eliminar = ocultar, no se borra, para no dañar órdenes viejas).
- **Descripción editable** en cada cotización (viene del producto).
- **Consecutivo automático** de la orden, empezando en 1 (no continúa el 4533 del Excel).
- **Orden de compra** idéntica al formato 08F-03, con PDF y opción de imprimir; datos del proveedor copiados a la orden (si luego cambia el proveedor, la orden vieja no cambia).
- **Anular** órdenes (no se borran) y **descarga a Excel** (CSV con `;` y tildes correctas).
- **Responsive** (se ve bien en celular), **sin login**.

---

## 3. Base de datos (Supabase)

Tablas:

| Tabla | Contenido |
|---|---|
| `com_proveedores` | Proveedores (id, nombre, nit, telefono, direccion, email, ciudad, rep_ventas, clasificacion, activo) |
| `com_productos` | Productos (tipo_producto, nombre_producto, unidad_medida, descripcion, activo) |
| `com_cotizaciones` | Una por producto cotizado (fecha, producto, descripcion, unidad, cantidad, proveedor_ganador_id, estado) |
| `com_cotizacion_proveedores` | Una fila por proveedor cotizado: precio, cond_comerciales, calificacion_precio, oportunidad, calidad, garantia, dias_garantia, total_puntos, es_ganador |
| `com_ordenes_compra` | La orden con copia de todo lo que sale en el PDF; `consecutivo` único con secuencia `com_oc_seq` |
| vista `com_base_ordenes` | La "Base de Datos Ordenes de Compra" que consulta la señora |

Seguridad (sin login): RLS activado y políticas para el rol `anon`: **ver y crear**; editar solo proveedores, productos y órdenes (para anular); **nada se puede borrar**.

El SQL completo se ejecutó en el SQL Editor de Supabase (proyecto `wigdvudbfyzhgdoxafuo`).

---

## 4. Estructura del código

```
index.html   Pantallas (cotización, orden, órdenes, productos, proveedores) y diálogos
style.css    Estilos (CSS simple, sin frameworks)
app.js       Toda la lógica: carga de datos, cálculo de puntos, guardado, orden/PDF
config.js    URL de Supabase y llave publishable (pública por diseño)
logo.png     Logo de Conequipos (sacado del Excel)
```

Librerías por CDN: `@supabase/supabase-js` 2.58.0 (jsdelivr) y `html2pdf.js` 0.10.1 (cdnjs).

Funciones clave de `app.js`: `calcular()` (puntajes y ganador), `puntosPrecio()`, `puntosGarantia()`, `procesarGuardado()` (inserta cotización → proveedores → orden), `ocHTML()` (hoja de la orden).

No se necesita archivo `.env`: es un sitio estático y los datos de `config.js` son públicos. **Nunca** poner la llave `service_role` en el código.

---

## 5. Despliegue

Cloudflare → Workers & Pages → Create → Pages → **Upload assets** → subir esta carpeta.
Si se cambia algo, se vuelve a subir la carpeta (misma URL).

---

## 6. Pendientes / ideas

- Probar de punta a punta contra el Supabase real (en desarrollo se probó con una base simulada).
- Editar proveedores desde la app (hoy solo se pueden agregar).
- Restringir el acceso con Cloudflare Access si más adelante se quiere cerrar el enlace.
- Revisar si el IVA debe poder ser distinto del 19 % por producto (hoy se edita al generar la orden).
- La pestaña "Evaluación de Proveedores" del Excel no se reconstruyó.
