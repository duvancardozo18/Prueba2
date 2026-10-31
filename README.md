# Buscador de inmuebles y unidades privadas – Catastro Bogotá

Aplicación web estática (HTML + CSS + JavaScript, sin backend ni dependencias).

## Uso

1. Abra `index.html` en el navegador (o sírvala con `python3 -m http.server`).
2. Elija la dirección con las listas (tipo de vía, número, letra, BIS, cruce, placa, cuadrante). La app arma el texto en el formato de `PREDIRECC`, p. ej. `KR 19 164 53`.
3. O use la pestaña **Por nombre de conjunto**: la lista de nombres (`NOMBRE_COPROPIEDAD`, valores distintos del censo PH) se carga una vez y se filtra mientras escribe. Al elegir uno se consultan sus `CODIGO_LOTE` y su dirección, y luego se traen los predios de Catastro de esos lotes, todos bajo el nombre del conjunto. La app prueba en orden, y usa la primera que traiga predios:
   1. `BARMANPRE IN (...)` con el lote normalizado a 12 dígitos (el censo puede publicar `CODIGO_LOTE` como número sin ceros a la izquierda). Si la capa declara `BARMANPRE` numérico, va sin comillas.
   2. `PRECBARRIO` + `PRECMANZ` + `PRECPREDIO` del lote (con y sin ceros), por si la capa no publica `BARMANPRE`.
   3. `PREDIRECC` = dirección del censo PH convertida al formato de Catastro (`CARRERA 19 # 164-53` → `KR 19 164 53`).
   Los lotes van en grupos de 50. Si ninguna trae predios, el mensaje lista cada intento con su resultado o el error del servicio.
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
