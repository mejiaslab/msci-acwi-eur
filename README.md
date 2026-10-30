# MSCI ACWI en Euros (€) — Panel Histórico desde 1999

Aplicación web ligera y estática para consultar la evolución histórica diaria del índice **MSCI ACWI (All Country World Index)** expresada en **euros (EUR)** desde el nacimiento del euro (**enero de 1999**, con cierre base 100 el **31 de diciembre de 1998**).

🌐 **Web publicada (GitHub Pages):** [https://mejiaslab.github.io/msci-acwi-eur/](https://mejiaslab.github.io/msci-acwi-eur/)

---

## Características principales

- **Gráfico interactivo de alta resolución** con selección rápida de horizonte temporal:
  - `1D` (Último día, con curva intradía XETRA) · `1S` (Última semana) · `1M` (Último mes) · `YTD` · `1A` · `3A` · `5A` · `10A` · `20A` · `Todo` (desde el 31/12/1998).
  - Tres modos de visualización: **Valor simulado (€)**, **Rentabilidad acumulada (%)** y **Drawdown (%)**, además de **escala logarítmica**.
  - **Simulador de inversión en €** integrado para comprobar cómo habría evolucionado cualquier importe inicial en el periodo elegido.
- **Doble variante en euros**:
  - **Total Return (dividendos netos reinvertidos)** — equivalente al comportamiento de un ETF de acumulación (por defecto).
  - **Solo Precio (Price Return)** — evolución pura del índice sin dividendos.
- **KPIs automáticos del periodo seleccionado**:
  - Rentabilidad acumulada (%) y resultado en €.
  - Rentabilidad anualizada (**CAGR / TAE**).
  - **Volatilidad anualizada** y oscilación diaria típica ($1\sigma$).
  - **Máximo Drawdown** (con fechas exactas de pico a valle).
  - **Ratio Retorno / Riesgo (Sharpe)** y porcentaje de sesiones en positivo.
  - **Máximo / mínimo** del periodo y mejor/peor sesión diaria.
- **Tabla de rentabilidades mensuales y anuales (1999 – presente)**:
  - Filas por año y columnas de **Enero a Diciembre** + **Total Año**, coloreadas como mapa de calor.
  - Filas resumen al pie con **Media**, **Mediana** y **% de meses positivos**.
  - Al hacer clic en cualquier año de la tabla, el gráfico y los KPIs muestran el detalle de ese ejercicio.
  - Exportación directa a **CSV** compatible con Excel / Google Sheets.
- **Actualización diaria desatendida**:
  - Una GitHub Action programada de lunes a viernes actualiza `data/msci_acwi_eur.json` y republica automáticamente GitHub Pages.

---

## Metodología de los datos

La serie histórica en euros (`data/msci_acwi_eur.json`, base `100,00` a `31/12/1998`) se construye combinando:

1. **Índice oficial MSCI ACWI en EUR (`892400`)**:
   - **Solo Precio (`STRD`)**: serie diaria oficial directa en EUR desde el `31/12/1998`.
   - **Total Return (`NETR`)**: serie diaria oficial MSCI ACWI EUR Net Total Return desde el `29/12/2000`, enlazada hacia atrás hasta el `31/12/1998` mediante la serie diaria oficial `STRD` en EUR más el devengo de dividendos netos implícito en MSCI ACWI EUR Gross Total Return (`GRTR`) en 1999–2000.
2. **ETF Proxy iShares MSCI ACWI UCITS ETF EUR Acc (`IUSQ.DE` · ISIN `IE00B6R52259`)**:
   - Proporciona las barras intradía en euros (XETRA) para la vista de **Último día (`1D`)** y sirve como fuente de respaldo para cierres diarios recientes.

---

## Uso en local

No requiere dependencias externas ni pasos de compilación (`HTML + CSS + JS vanilla` y `Python 3` estándar):

```bash
# 1. (Opcional) Refrescar los datos históricos e intradía
python3 scripts/update_data.py

# 2. Servir la web estática localmente
python3 -m http.server 8000
```

Después abre `http://localhost:8000` en tu navegador.
