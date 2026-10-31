# Buscador de inmuebles y unidades privadas – Catastro Bogotá

Aplicación web estática (HTML + CSS + JavaScript, sin backend ni dependencias).

## Uso

1. Abra `index.html` en el navegador (o sírvala con `python3 -m http.server`).
2. Pulse **Verificar servicio** para confirmar capa, campos y límite de registros.
3. Ingrese los criterios (precargado el caso Rincón del Palmar) y pulse **Buscar**.
4. Filtre por tipo (Apartamento / Garaje / Otro), ordene por columna y exporte a **CSV** o **Excel**.

## Qué hace

- Construye el `WHERE` (dirección, barrio, clase, CHIP, manzana, predio) con comillas escapadas.
- Consulta ArcGIS REST con `returnCountOnly` y pagina con `resultOffset` hasta el máximo configurado.
- Clasifica unidades por la dirección (`GJ` garaje, `AP` apartamento, `IN` interior).
- Usa el **CHIP como identificador**; descarta duplicados y avisa de registros sin CHIP.
- Alerta si hay truncamiento o huecos en la numeración de garajes.

## Estado de verificación (importante)

- El endpoint `.../catastro/lote/MapServer/3/query` **no pudo verificarse** desde el entorno de desarrollo (sin acceso de red a ese host). Se confirmó que el servidor `serviciosgis.catastrobogota.gov.co` existe y publica servicios REST, pero no la capa 3 ni sus campos.
- La lógica (WHERE, clasificación, deduplicación, CSV) se probó con datos de ejemplo del documento, no con respuestas reales.
- Si el navegador bloquea la consulta por CORS o el servicio cambió, use **Cargar JSON pegado**: abra la URL de la consulta generada en una pestaña, copie el JSON y péguelo.
- El endpoint es editable en «Configuración del servicio».

## Estructura

```
index.html
css/styles.css
js/catastro-api.js   consulta, paginación, clasificación
js/export.js         CSV / Excel
js/app.js            interfaz
```

## Pendiente

- Prueba real contra el servicio y comparación con el JSON original de Rincón del Palmar.
- Fuentes adicionales (información jurídica/administrativa).
