# Buscador de inmuebles y unidades privadas – Catastro Bogotá

Aplicación web estática (HTML + CSS + JavaScript, sin backend ni dependencias).

## Uso

1. Abra `index.html` en el navegador (o sírvala con `python3 -m http.server`).
2. Elija la dirección con las listas (tipo de vía, número, letra, BIS, cruce, placa, cuadrante). La app arma el texto en el formato de `PREDIRECC`, p. ej. `KR 19 164 53`.
3. O use la pestaña **Por nombre de conjunto**: la lista de nombres (`NOMBRE_COPROPIEDAD`, valores distintos del censo PH) se carga una vez y se filtra mientras escribe. Al elegir uno se consultan sus `CODIGO_LOTE` y la búsqueda catastral usa `BARMANPRE IN (...)`.
4. Pulse **Buscar inmuebles**.
5. Filtre los resultados por tipo (pestañas con conteo), interior/torre o texto (`AP 101`, `GJ 5`…), ordene por columna y descargue **PDF** o **Excel**.
6. La pestaña **Info** reúne lo técnico: endpoint, verificación del servicio, consulta generada, carga manual de JSON y ejemplo.

## Qué hace

- Construye el `WHERE` con comillas escapadas. La dirección coincide exacta o seguida de la unidad (`PREDIRECC = 'X' OR PREDIRECC LIKE 'X %'`), así `KR 19 164 5` no trae `KR 19 164 53`.
- Consulta ArcGIS REST con `returnCountOnly` y pagina con `resultOffset` hasta el máximo configurado.
- Obtiene el **nombre del conjunto** con una segunda consulta al censo de equipamiento comunal PH (`censoequipamientocomunalph/MapServer/0`), usando `CODIGO_LOTE = BARMANPRE` de la primera consulta (en grupos de 50 lotes). Agrega `NOMBRE_COPROPIEDAD` y `TIPO_PH` a la tabla, al PDF y al Excel.
- Clasifica unidades por la dirección (`GJ` garaje, `AP` apartamento, `IN` interior).
- Usa el **CHIP como identificador**; descarta duplicados y avisa de registros sin CHIP.
- Alerta si hay truncamiento o huecos en la numeración de garajes.

## Estado de verificación (importante)

- El endpoint `.../catastro/lote/MapServer/3/query` **no pudo verificarse** desde el entorno de desarrollo (sin acceso de red a ese host). Se confirmó que el servidor `serviciosgis.catastrobogota.gov.co` existe y publica servicios REST, pero no la capa 3 ni sus campos.
- La lógica (WHERE, clasificación, deduplicación, CSV) se probó con datos de ejemplo del documento, no con respuestas reales.
- Si el navegador bloquea la consulta por CORS o el servicio cambió, use **Info → Cargar JSON**: abra la URL de la consulta generada en una pestaña, copie el JSON y péguelo.
- El endpoint es editable en la pestaña **Info**.

## Estructura

```
index.html
css/styles.css
js/catastro-api.js   consulta, paginación, clasificación
js/export.js         PDF / Excel (sin dependencias)
js/app.js            interfaz
```

## Pendiente

- Prueba real contra el servicio y comparación con el JSON original de Rincón del Palmar.
- Fuentes adicionales (información jurídica/administrativa).
