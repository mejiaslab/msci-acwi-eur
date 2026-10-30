(() => {
  "use strict";

  const MONTH_NAMES_SHORT = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
  ];
  const MONTH_NAMES_FULL = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  // Estado global de la aplicación
  const state = {
    raw: null,
    variant: "tr", // 'tr' (Total Return) | 'pr' (Price Return)
    period: "ALL", // '1D' | '1W' | '1M' | 'YTD' | '1Y' | '3Y' | '5Y' | '10Y' | '20Y' | 'ALL'
    customYear: null, // número de año si el usuario hace clic en una fila de la tabla
    chartMode: "value", // 'value' | 'pct' | 'drawdown'
    logScale: false,
    initialInvestment: 10000,
    sortDesc: true,
    hoverIndex: null,
    currentPlot: null, // datos preparados actualmente en el canvas
  };

  // Referencias al DOM
  const el = {
    statusBanner: document.getElementById("statusBanner"),
    mainContent: document.getElementById("mainContent"),
    headerHistoryBadge: document.getElementById("headerHistoryBadge"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    periodDateRange: document.getElementById("periodDateRange"),
    clearCustomYearBtn: document.getElementById("clearCustomYearBtn"),
    heroReturnPct: document.getElementById("heroReturnPct"),
    heroLevelDetail: document.getElementById("heroLevelDetail"),
    investmentInput: document.getElementById("investmentInput"),
    simFinalValue: document.getElementById("simFinalValue"),
    simProfitValue: document.getElementById("simProfitValue"),
    logToggleWrap: document.getElementById("logToggleWrap"),
    logScaleCheckbox: document.getElementById("logScaleCheckbox"),
    chartContainer: document.getElementById("chartContainer"),
    canvas: document.getElementById("priceChart"),
    tooltip: document.getElementById("chartTooltip"),
    chartFootnote: document.getElementById("chartFootnote"),

    // KPIs
    kpiTotalReturn: document.getElementById("kpiTotalReturn"),
    kpiTotalReturnSub: document.getElementById("kpiTotalReturnSub"),
    kpiCagr: document.getElementById("kpiCagr"),
    kpiCagrSub: document.getElementById("kpiCagrSub"),
    kpiVolatility: document.getElementById("kpiVolatility"),
    kpiVolatilitySub: document.getElementById("kpiVolatilitySub"),
    kpiMaxDrawdown: document.getElementById("kpiMaxDrawdown"),
    kpiMaxDrawdownSub: document.getElementById("kpiMaxDrawdownSub"),
    kpiSharpe: document.getElementById("kpiSharpe"),
    kpiPositiveDaysSub: document.getElementById("kpiPositiveDaysSub"),
    kpiRange: document.getElementById("kpiRange"),
    kpiBestWorstDaySub: document.getElementById("kpiBestWorstDaySub"),

    // Tabla mensual
    monthlyTableBody: document.getElementById("monthlyTableBody"),
    monthlyTableFoot: document.getElementById("monthlyTableFoot"),
    sortYearBtn: document.getElementById("sortYearBtn"),
    sortYearLabel: document.getElementById("sortYearLabel"),
    downloadCsvBtn: document.getElementById("downloadCsvBtn"),

    // Footer meta
    methodologyText: document.getElementById("methodologyText"),
    metaLastDate: document.getElementById("metaLastDate"),
    metaTotalDays: document.getElementById("metaTotalDays"),
    metaEtfPrice: document.getElementById("metaEtfPrice"),
    metaUpdatedAt: document.getElementById("metaUpdatedAt"),
  };

  // Formateadores numéricos en español
  const nfNum2 = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const nfInt = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 0,
  });

  function fmtPct(val, decimals = 2, withSign = true) {
    if (val === null || val === undefined || !Number.isFinite(val)) return "—";
    const absStr = Math.abs(val).toLocaleString("es-ES", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    if (!withSign) return `${val < 0 ? "-" : ""}${absStr}%`;
    const sign = val > 0.00005 ? "+" : val < -0.00005 ? "-" : "";
    return `${sign}${absStr}%`;
  }

  function fmtEur(val) {
    if (val === null || val === undefined || !Number.isFinite(val)) return "—";
    const abs = Math.abs(val);
    const decimals = abs >= 1000 ? 0 : 2;
    return (
      val.toLocaleString("es-ES", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + " €"
    );
  }

  function fmtEurCompactAxis(val) {
    if (!Number.isFinite(val)) return "";
    const abs = Math.abs(val);
    if (abs >= 1_000_000) {
      return (val / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " M€";
    }
    if (abs >= 10_000) {
      return (val / 1_000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " mil €";
    }
    return fmtEur(val);
  }

  function fmtDateEs(isoStr) {
    if (!isoStr) return "—";
    if (isoStr.includes("T")) {
      const d = new Date(isoStr);
      return d.toLocaleString("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Madrid",
      });
    }
    const [y, m, d] = isoStr.split("-").map(Number);
    return `${d} ${MONTH_NAMES_SHORT[m - 1].toLowerCase()} ${y}`;
  }

  // Búsqueda binaria: último índice cuya fecha sea <= targetIso
  function findIndexOnOrBefore(dates, targetIso) {
    let lo = 0;
    let hi = dates.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= targetIso) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function subtractPeriodFromIso(isoDate, unit, amount) {
    const [y, m, d] = isoDate.split("-").map(Number);
    const dtObj = new Date(Date.UTC(y, m - 1, d));
    if (unit === "days") {
      dtObj.setUTCDate(dtObj.getUTCDate() - amount);
    } else if (unit === "months") {
      const targetMonth = dtObj.getUTCMonth() - amount;
      const targetYear = dtObj.getUTCFullYear() + Math.floor(targetMonth / 12);
      const normMonth = ((targetMonth % 12) + 12) % 12;
      const maxDay = new Date(Date.UTC(targetYear, normMonth + 1, 0)).getUTCDate();
      return `${targetYear}-${String(normMonth + 1).padStart(2, "0")}-${String(
        Math.min(d, maxDay)
      ).padStart(2, "0")}`;
    } else if (unit === "years") {
      const targetYear = y - amount;
      const maxDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
      return `${targetYear}-${String(m).padStart(2, "0")}-${String(
        Math.min(d, maxDay)
      ).padStart(2, "0")}`;
    }
    return dtObj.toISOString().slice(0, 10);
  }

  function getActiveSeries() {
    return state.variant === "tr" ? state.raw.tr : state.raw.pr;
  }

  // Extrae el subconjunto de datos correspondiente al periodo o año activo
  function extractPeriodSlice() {
    const dates = state.raw.dates;
    const values = getActiveSeries();
    const n = dates.length;
    const lastIso = dates[n - 1];
    const lastYear = Number(lastIso.slice(0, 4));

    // Caso 1: año específico seleccionado en la tabla mensual
    if (state.customYear !== null) {
      const yr = state.customYear;
      const prevYearEnd = `${yr - 1}-12-31`;
      const thisYearEnd = `${yr}-12-31`;
      const startIdx = findIndexOnOrBefore(dates, prevYearEnd);
      const endIdx = findIndexOnOrBefore(dates, thisYearEnd);
      return {
        labels: dates.slice(startIdx, endIdx + 1),
        values: values.slice(startIdx, endIdx + 1),
        startDate: dates[startIdx],
        endDate: dates[endIdx],
        isIntraday: false,
        footnote: `Mostrando el ejercicio ${yr} completo (desde cierre previo ${fmtDateEs(
          dates[startIdx]
        )} hasta ${fmtDateEs(dates[endIdx])}).`,
      };
    }

    // Caso 2: Último día (1D)
    if (state.period === "1D") {
      const prevIdx = Math.max(0, n - 2);
      const prevVal = values[prevIdx];
      const lastVal = values[n - 1];
      const intra = state.raw.intraday1d;

      // Si disponemos de barras intradía recientes del ETF proxy, las escalamos sobre el cierre previo
      if (
        intra &&
        Array.isArray(intra.prices) &&
        intra.prices.length >= 3 &&
        intra.prevClose > 0 &&
        intra.date >= dates[Math.max(0, n - 3)]
      ) {
        const labels = [dates[prevIdx] + "T16:30:00Z"];
        const intraVals = [prevVal];

        for (let i = 0; i < intra.prices.length; i++) {
          labels.push(intra.timestamps[i]);
          intraVals.push(prevVal * (intra.prices[i] / intra.prevClose));
        }

        // Si el cierre oficial de MSCI de ese mismo día ya está publicado (tras cierre de EE. UU.), añadir punto de cierre global
        if (intra.date === lastIso) {
          labels.push(lastIso + "T21:00:00Z");
          intraVals.push(lastVal);
        }

        return {
          labels,
          values: intraVals,
          startDate: dates[prevIdx],
          endDate: lastIso,
          isIntraday: true,
          footnote:
            "Vista 1D: trayectoria intradía en EUR vía ETF proxy iShares MSCI ACWI (IUSQ.DE · XETRA) enlazada con el cierre diario oficial del índice.",
        };
      }

      // Respaldo limpio si no hay barras intradía: mostrar transición de la última sesión
      return {
        labels: [dates[prevIdx], lastIso],
        values: [prevVal, lastVal],
        startDate: dates[prevIdx],
        endDate: lastIso,
        isIntraday: false,
        footnote: `Variación de la última sesión disponible (${fmtDateEs(
          dates[prevIdx]
        )} → ${fmtDateEs(lastIso)}).`,
      };
    }

    // Caso 3: Resto de horizontes temporales
    let startIdx = 0;
    switch (state.period) {
      case "1W":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "days", 7));
        break;
      case "1M":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "months", 1));
        break;
      case "YTD":
        startIdx = findIndexOnOrBefore(dates, `${lastYear - 1}-12-31`);
        break;
      case "1Y":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "years", 1));
        break;
      case "3Y":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "years", 3));
        break;
      case "5Y":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "years", 5));
        break;
      case "10Y":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "years", 10));
        break;
      case "20Y":
        startIdx = findIndexOnOrBefore(dates, subtractPeriodFromIso(lastIso, "years", 20));
        break;
      case "ALL":
      default:
        startIdx = 0;
        break;
    }

    if (startIdx >= n - 1) startIdx = Math.max(0, n - 2);

    return {
      labels: dates.slice(startIdx),
      values: values.slice(startIdx),
      startDate: dates[startIdx],
      endDate: lastIso,
      isIntraday: false,
      footnote:
        state.period === "ALL"
          ? "Histórico completo en euros desde el 31 dic 1998 (tipo de conversión inaugural del euro el 1 ene 1999)."
          : "",
    };
  }

  // Cálculo de todos los KPIs financieros sobre el tramo activo
  function computeKPIs(slice) {
    const vals = slice.values;
    const labels = slice.labels;
    const m = vals.length;
    const v0 = vals[0];
    const vEnd = vals[m - 1];

    const totalReturnPct = (vEnd / v0 - 1) * 100;

    // Años exactos transcurridos entre fecha inicial y final
    const t0 = Date.parse(slice.startDate + "T00:00:00Z");
    const tEnd = Date.parse(slice.endDate + "T00:00:00Z");
    const calendarDays = Math.max(1, (tEnd - t0) / 86_400_000);
    const years = calendarDays / 365.2425;

    let cagrPct = null;
    if (years >= 0.95) {
      cagrPct = (Math.pow(vEnd / v0, 1 / years) - 1) * 100;
    }

    // Retornos paso a paso
    const stepReturns = [];
    let posCount = 0;
    let bestStep = -Infinity;
    let bestStepDate = null;
    let worstStep = Infinity;
    let worstStepDate = null;

    for (let i = 1; i < m; i++) {
      const r = vals[i] / vals[i - 1] - 1;
      stepReturns.push(r);
      if (r > 0) posCount++;
      if (r > bestStep) {
        bestStep = r;
        bestStepDate = labels[i];
      }
      if (r < worstStep) {
        worstStep = r;
        worstStepDate = labels[i];
      }
    }

    // Media y desviación típica muestral
    const k = stepReturns.length;
    const meanStep = k > 0 ? stepReturns.reduce((a, b) => a + b, 0) / k : 0;
    let variance = 0;
    if (k >= 2) {
      for (let i = 0; i < k; i++) {
        const diff = stepReturns[i] - meanStep;
        variance += diff * diff;
      }
      variance /= k - 1;
    }
    const stdStep = Math.sqrt(variance);
    // Factor de anualización: 252 sesiones diarias (o aprox barras/año si es intradía)
    const annFactor = slice.isIntraday ? 252 * Math.max(1, k) : 252;
    const volAnnualPct = k >= 2 ? stdStep * Math.sqrt(annFactor) * 100 : null;

    // Máximo Drawdown y serie de drawdowns
    let peakVal = vals[0];
    let peakDate = labels[0];
    let maxDDPct = 0;
    let ddPeakDate = labels[0];
    let ddTroughDate = labels[0];
    const drawdownSeries = new Array(m);

    // Máximo y mínimo absolutos del periodo
    let maxVal = vals[0];
    let maxDate = labels[0];
    let minVal = vals[0];
    let minDate = labels[0];

    for (let i = 0; i < m; i++) {
      const v = vals[i];
      if (v > peakVal) {
        peakVal = v;
        peakDate = labels[i];
      }
      const dd = (v / peakVal - 1) * 100;
      drawdownSeries[i] = dd;
      if (dd < maxDDPct) {
        maxDDPct = dd;
        ddPeakDate = peakDate;
        ddTroughDate = labels[i];
      }
      if (v > maxVal) {
        maxVal = v;
        maxDate = labels[i];
      }
      if (v < minVal) {
        minVal = v;
        minDate = labels[i];
      }
    }

    // Ratio Retorno / Riesgo (Sharpe con Rf = 0%)
    let sharpe = null;
    if (!slice.isIntraday && volAnnualPct && volAnnualPct > 0.0001) {
      if (cagrPct !== null) {
        sharpe = cagrPct / volAnnualPct;
      } else if (k >= 5) {
        const annArith = meanStep * 252 * 100;
        sharpe = annArith / volAnnualPct;
      }
    }

    return {
      v0,
      vEnd,
      totalReturnPct,
      cagrPct,
      years,
      calendarDays,
      sessions: k,
      meanStepPct: meanStep * 100,
      stdStepPct: stdStep * 100,
      volAnnualPct,
      maxDDPct,
      ddPeakDate,
      ddTroughDate,
      sharpe,
      posRatioPct: k > 0 ? (posCount / k) * 100 : null,
      posCount,
      maxVal,
      maxDate,
      minVal,
      minDate,
      bestStepPct: Number.isFinite(bestStep) ? bestStep * 100 : null,
      bestStepDate,
      worstStepPct: Number.isFinite(worstStep) ? worstStep * 100 : null,
      worstStepDate,
      drawdownSeries,
    };
  }

  // Renderizado de cabecera de métricas y tarjetas KPI
  function renderHeroAndKPIs(slice, kpis) {
    const simInit = state.initialInvestment;
    const simEnd = simInit * (kpis.vEnd / kpis.v0);
    const simDiff = simEnd - simInit;

    el.periodDateRange.textContent = `${fmtDateEs(slice.startDate)} → ${fmtDateEs(
      slice.endDate
    )}`;

    if (state.customYear !== null) {
      el.clearCustomYearBtn.classList.remove("hidden");
    } else {
      el.clearCustomYearBtn.classList.add("hidden");
    }

    // Hero principal
    el.heroReturnPct.textContent = fmtPct(kpis.totalReturnPct, 2, true);
    el.heroReturnPct.classList.toggle("positive", kpis.totalReturnPct >= 0);
    el.heroReturnPct.classList.toggle("negative", kpis.totalReturnPct < 0);

    const variantLabel = state.variant === "tr" ? "Total Return" : "Solo Precio";
    el.heroLevelDetail.textContent = `Índice (${variantLabel}, base 100): ${nfNum2.format(
      kpis.v0
    )} → ${nfNum2.format(kpis.vEnd)}`;

    // Simulador en €
    el.simFinalValue.textContent = fmtEur(simEnd);
    const diffSign = simDiff >= 0 ? "+" : "";
    el.simProfitValue.textContent = `(${diffSign}${fmtEur(simDiff)})`;
    el.simProfitValue.className = "sim-diff " + (simDiff >= 0 ? "positive" : "negative");

    // 1. Rentabilidad Acumulada
    el.kpiTotalReturn.textContent = fmtPct(kpis.totalReturnPct, 2, true);
    el.kpiTotalReturn.className =
      "kpi-value " + (kpis.totalReturnPct >= 0 ? "positive" : "negative");
    el.kpiTotalReturnSub.textContent = `${fmtEur(simInit)} → ${fmtEur(simEnd)} (${nfInt.format(
      Math.round(kpis.calendarDays)
    )} días nat.)`;

    // 2. CAGR
    if (kpis.cagrPct !== null) {
      el.kpiCagr.textContent = fmtPct(kpis.cagrPct, 2, true) + " / año";
      el.kpiCagr.className = "kpi-value " + (kpis.cagrPct >= 0 ? "positive" : "negative");
      el.kpiCagrSub.textContent = `Horizonte de ${kpis.years.toLocaleString("es-ES", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} años (multiplicador ${(kpis.vEnd / kpis.v0).toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}x)`;
    } else {
      el.kpiCagr.textContent = "— (< 1 año)";
      el.kpiCagr.className = "kpi-value";
      el.kpiCagrSub.textContent = slice.isIntraday
        ? `Sesión intradía (${kpis.sessions} intervalos)`
        : `Variación media diaria: ${fmtPct(kpis.meanStepPct, 2, true)}`;
    }

    // 3. Volatilidad
    if (kpis.volAnnualPct !== null) {
      el.kpiVolatility.textContent = fmtPct(kpis.volAnnualPct, 2, false);
      el.kpiVolatility.className = "kpi-value";
      el.kpiVolatilitySub.textContent = slice.isIntraday
        ? "Estimada sobre volatilidad intradía de la sesión"
        : `Oscilación diaria típica (1σ): ±${nfNum2.format(kpis.stdStepPct)}%`;
    } else {
      el.kpiVolatility.textContent = "—";
      el.kpiVolatility.className = "kpi-value";
      el.kpiVolatilitySub.textContent = "Se requieren al menos 2 sesiones";
    }

    // 4. Máximo Drawdown
    el.kpiMaxDrawdown.textContent = fmtPct(kpis.maxDDPct, 2, false);
    if (kpis.maxDDPct < -0.01) {
      el.kpiMaxDrawdownSub.textContent = `Pico: ${fmtDateEs(kpis.ddPeakDate)} → Valle: ${fmtDateEs(
        kpis.ddTroughDate
      )}`;
    } else {
      el.kpiMaxDrawdownSub.textContent = "Sin caídas registradas en el tramo";
    }

    // 5. Sharpe y sesiones positivas
    if (kpis.sharpe !== null) {
      el.kpiSharpe.textContent = kpis.sharpe.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      el.kpiSharpe.className = "kpi-value " + (kpis.sharpe >= 0 ? "positive" : "negative");
    } else {
      el.kpiSharpe.textContent = "—";
      el.kpiSharpe.className = "kpi-value";
    }
    if (kpis.posRatioPct !== null) {
      const unitWord = slice.isIntraday ? "tramos" : "sesiones";
      el.kpiPositiveDaysSub.textContent = `${nfNum2.format(
        kpis.posRatioPct
      )}% ${unitWord} en verde (${nfInt.format(kpis.posCount)}/${nfInt.format(kpis.sessions)})`;
    } else {
      el.kpiPositiveDaysSub.textContent = "—";
    }

    // 6. Extremos del periodo
    const simMax = simInit * (kpis.maxVal / kpis.v0);
    const simMin = simInit * (kpis.minVal / kpis.v0);
    el.kpiRange.textContent = `Máx ${fmtEur(simMax)} · Mín ${fmtEur(simMin)}`;
    if (!slice.isIntraday && kpis.sessions >= 2 && kpis.bestStepPct !== null) {
      el.kpiBestWorstDaySub.textContent = `Mejor día: ${fmtPct(
        kpis.bestStepPct,
        2,
        true
      )} · Peor día: ${fmtPct(kpis.worstStepPct, 2, true)}`;
    } else {
      el.kpiBestWorstDaySub.textContent = `Máx: ${fmtDateEs(kpis.maxDate)} · Mín: ${fmtDateEs(
        kpis.minDate
      )}`;
    }

    el.chartFootnote.textContent = slice.footnote || "";
  }

  // Algoritmo LTTB (Largest-Triangle-Three-Buckets) para muestreo visual nítido
  function downsampleLTTB(yArr, threshold) {
    const len = yArr.length;
    if (threshold >= len || threshold < 3) {
      return yArr.map((_, idx) => idx);
    }
    const sampledIndices = [0];
    const bucketSize = (len - 2) / (threshold - 2);
    let a = 0;

    for (let i = 0; i < threshold - 2; i++) {
      const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
      let avgX = 0;
      let avgY = 0;
      const avgLen = Math.max(1, avgRangeEnd - avgRangeStart);
      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += j;
        avgY += yArr[j];
      }
      avgX /= avgLen;
      avgY /= avgLen;

      const rangeOffs = Math.floor(i * bucketSize) + 1;
      const rangeTo = Math.min(Math.floor((i + 1) * bucketSize) + 1, len - 1);

      const pointAX = a;
      const pointAY = yArr[a];
      let maxArea = -1;
      let nextA = rangeOffs;

      for (let j = rangeOffs; j < rangeTo; j++) {
        const area = Math.abs(
          (pointAX - avgX) * (yArr[j] - pointAY) - (pointAX - j) * (avgY - pointAY)
        );
        if (area > maxArea) {
          maxArea = area;
          nextA = j;
        }
      }
      sampledIndices.push(nextA);
      a = nextA;
    }
    sampledIndices.push(len - 1);
    return sampledIndices;
  }

  // Preparación de coordenadas y dibujado del gráfico en Canvas de alta densidad
  function prepareAndDrawChart(slice, kpis) {
    const vals = slice.values;
    const m = vals.length;
    const v0 = vals[0];
    const simInit = state.initialInvestment;

    let displaySeries;
    let baselineYValue = null;

    if (state.chartMode === "value") {
      displaySeries = vals.map((v) => simInit * (v / v0));
      baselineYValue = simInit;
    } else if (state.chartMode === "pct") {
      displaySeries = vals.map((v) => (v / v0 - 1) * 100);
      baselineYValue = 0;
    } else {
      displaySeries = kpis.drawdownSeries;
      baselineYValue = 0;
    }

    const useLog = state.logScale && state.chartMode === "value";

    state.currentPlot = {
      slice,
      kpis,
      displaySeries,
      baselineYValue,
      useLog,
    };

    drawCanvas();
  }

  function drawCanvas() {
    if (!state.currentPlot) return;
    const { slice, kpis, displaySeries, baselineYValue, useLog } = state.currentPlot;
    const canvas = el.canvas;
    const rect = el.chartContainer.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const gridColor = styles.getPropertyValue("--chart-grid").trim() || "rgba(148,163,184,0.12)";
    const textMuted = styles.getPropertyValue("--text-muted").trim() || "#64748b";
    const crosshairColor =
      styles.getPropertyValue("--chart-crosshair").trim() || "rgba(148,163,184,0.4)";
    const posColor = styles.getPropertyValue("--positive").trim() || "#10b981";
    const negColor = styles.getPropertyValue("--negative").trim() || "#ef4444";

    const padLeft = width < 520 ? 8 : 12;
    const padRight = width < 520 ? 58 : 74;
    const padTop = 14;
    const padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const m = displaySeries.length;
    const transformY = useLog ? (v) => Math.log10(Math.max(1e-6, v)) : (v) => v;
    const invTransformY = useLog ? (tv) => Math.pow(10, tv) : (tv) => tv;

    let minRaw = Infinity;
    let maxRaw = -Infinity;
    for (let i = 0; i < m; i++) {
      const v = displaySeries[i];
      if (v < minRaw) minRaw = v;
      if (v > maxRaw) maxRaw = v;
    }
    if (baselineYValue !== null) {
      if (baselineYValue < minRaw) minRaw = baselineYValue;
      if (baselineYValue > maxRaw) maxRaw = baselineYValue;
    }

    let tMin = transformY(minRaw);
    let tMax = transformY(maxRaw);
    if (Math.abs(tMax - tMin) < 1e-6) {
      tMin -= 1;
      tMax += 1;
    } else {
      const margin = (tMax - tMin) * 0.07;
      tMin -= margin;
      if (state.chartMode === "drawdown") {
        tMax = 0 + margin * 0.25;
      } else {
        tMax += margin;
      }
    }

    const xOfIndex = (idx) =>
      m <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (m - 1)) * plotW;
    const yOfVal = (rawVal) => {
      const tv = transformY(rawVal);
      return padTop + (1 - (tv - tMin) / (tMax - tMin)) * plotH;
    };

    // Líneas horizontales de cuadrícula y etiquetas del eje Y (a la derecha)
    const gridRows = 5;
    ctx.font = '500 11px "Inter", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let g = 0; g <= gridRows; g++) {
      const ratio = g / gridRows;
      const y = padTop + ratio * plotH;
      const tv = tMax - ratio * (tMax - tMin);
      const val = invTransformY(tv);

      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, Math.round(y) + 0.5);
      ctx.lineTo(padLeft + plotW, Math.round(y) + 0.5);
      ctx.stroke();

      let labelTxt = "";
      if (state.chartMode === "value") {
        labelTxt = fmtEurCompactAxis(val);
      } else {
        labelTxt = fmtPct(val, Math.abs(val) >= 100 ? 0 : 1, state.chartMode === "pct");
      }
      ctx.fillStyle = textMuted;
      ctx.fillText(labelTxt, padLeft + plotW + 7, y);
    }

    // Línea de referencia base (inversión inicial o 0%)
    if (baselineYValue !== null) {
      const yBase = yOfVal(baselineYValue);
      if (yBase >= padTop && yBase <= padTop + plotH) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = crosshairColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, yBase);
        ctx.lineTo(padLeft + plotW, yBase);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Etiquetas del eje X (fechas u horas)
    const tickCount = Math.min(m, width < 520 ? 4 : 7);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = textMuted;

    for (let t = 0; t < tickCount; t++) {
      const idx = tickCount === 1 ? 0 : Math.round((t / (tickCount - 1)) * (m - 1));
      const x = xOfIndex(idx);
      const rawLbl = slice.labels[idx];
      let txt = "";
      if (slice.isIntraday && rawLbl.includes("T")) {
        txt = new Date(rawLbl).toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Madrid",
        });
      } else if (kpis.years >= 4) {
        txt = rawLbl.slice(0, 4);
      } else if (kpis.years >= 0.8) {
        const [yy, mm] = rawLbl.split("-");
        txt = `${MONTH_NAMES_SHORT[Number(mm) - 1]} ${yy.slice(2)}`;
      } else {
        const [, mm, dd] = rawLbl.split("-");
        txt = `${Number(dd)} ${MONTH_NAMES_SHORT[Number(mm) - 1].toLowerCase()}`;
      }

      const clampedX = Math.max(padLeft + 22, Math.min(padLeft + plotW - 22, x));
      ctx.fillText(txt, clampedX, padTop + plotH + 8);
    }

    // Selección de color principal según modo y signo del periodo
    const isNegative =
      state.chartMode === "drawdown" || (state.chartMode !== "drawdown" && kpis.totalReturnPct < 0);
    const strokeColor = isNegative ? negColor : posColor;

    // Puntos muestreados para trazo fluido
    const maxBuckets = Math.max(120, Math.floor(plotW * 1.4));
    const sampledIdx = downsampleLTTB(displaySeries, maxBuckets);

    // Relleno degradado bajo/sobre la curva
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    if (state.chartMode === "drawdown") {
      grad.addColorStop(0, "rgba(239, 68, 68, 0.04)");
      grad.addColorStop(1, "rgba(239, 68, 68, 0.28)");
    } else if (isNegative) {
      grad.addColorStop(0, "rgba(239, 68, 68, 0.24)");
      grad.addColorStop(1, "rgba(239, 68, 68, 0.01)");
    } else {
      grad.addColorStop(0, "rgba(16, 185, 129, 0.26)");
      grad.addColorStop(1, "rgba(16, 185, 129, 0.01)");
    }

    const fillBaselineY =
      state.chartMode === "drawdown" ? yOfVal(0) : padTop + plotH;

    ctx.beginPath();
    ctx.moveTo(xOfIndex(sampledIdx[0]), fillBaselineY);
    for (let i = 0; i < sampledIdx.length; i++) {
      const idx = sampledIdx[i];
      ctx.lineTo(xOfIndex(idx), yOfVal(displaySeries[idx]));
    }
    ctx.lineTo(xOfIndex(sampledIdx[sampledIdx.length - 1]), fillBaselineY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Línea principal
    ctx.beginPath();
    for (let i = 0; i < sampledIdx.length; i++) {
      const idx = sampledIdx[i];
      const px = xOfIndex(idx);
      const py = yOfVal(displaySeries[idx]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Si hay muy pocos puntos (ej. respaldo de 2 sesiones), mostrar marcadores circulares
    if (m <= 10) {
      for (let i = 0; i < m; i++) {
        ctx.beginPath();
        ctx.arc(xOfIndex(i), yOfVal(displaySeries[i]), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
      }
    }

    // Cursor interactivo (hover)
    if (state.hoverIndex !== null && state.hoverIndex >= 0 && state.hoverIndex < m) {
      const hIdx = state.hoverIndex;
      const hx = xOfIndex(hIdx);
      const hy = yOfVal(displaySeries[hIdx]);

      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = crosshairColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, padTop + plotH);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      updateTooltipPositionAndContent(hIdx, hx, hy, width, padLeft, plotW);
    } else {
      el.tooltip.classList.add("hidden");
    }

    ctx.restore();
  }

  function updateTooltipPositionAndContent(idx, hx, hy, containerW) {
    const { slice, kpis } = state.currentPlot;
    const rawVal = slice.values[idx];
    const v0 = slice.values[0];
    const simEur = state.initialInvestment * (rawVal / v0);
    const pctFromStart = (rawVal / v0 - 1) * 100;
    const ddAtPoint = kpis.drawdownSeries[idx];

    const pctClass = pctFromStart >= 0 ? "positive" : "negative";
    el.tooltip.innerHTML = `
      <div class="tt-date">${fmtDateEs(slice.labels[idx])}</div>
      <div class="tt-row">
        <span class="tt-label">Valor simulado:</span>
        <span class="tt-val">${fmtEur(simEur)}</span>
      </div>
      <div class="tt-row">
        <span class="tt-label">Rentab. periodo:</span>
        <span class="tt-val ${pctClass}">${fmtPct(pctFromStart, 2, true)}</span>
      </div>
      <div class="tt-row">
        <span class="tt-label">Drawdown:</span>
        <span class="tt-val ${ddAtPoint < -0.01 ? "negative" : ""}">${fmtPct(
      ddAtPoint,
      2,
      false
    )}</span>
      </div>
      <div class="tt-row">
        <span class="tt-label">Nivel base 100:</span>
        <span class="tt-val">${nfNum2.format(rawVal)}</span>
      </div>
    `;
    el.tooltip.classList.remove("hidden");

    const ttRect = el.tooltip.getBoundingClientRect();
    let left = hx + 14;
    if (left + ttRect.width > containerW - 10) {
      left = hx - ttRect.width - 14;
    }
    left = Math.max(8, left);
    const top = Math.max(10, Math.min(hy - ttRect.height / 2, 260));

    el.tooltip.style.left = `${left}px`;
    el.tooltip.style.top = `${top}px`;
  }

  // Construcción de la matriz mensual (años x 12 meses + total anual + estadísticas resumen)
  function computeMonthlyMatrix() {
    const dates = state.raw.dates;
    const vals = getActiveSeries();

    // Agrupar el último cierre disponible de cada (año, mes)
    const monthEndMap = new Map(); // key "YYYY-MM" -> { val, date }
    for (let i = 0; i < dates.length; i++) {
      const ym = dates[i].slice(0, 7);
      monthEndMap.set(ym, { val: vals[i], date: dates[i] });
    }

    const firstYear = 1999;
    const lastYear = Number(dates[dates.length - 1].slice(0, 4));

    // Cierre base diciembre 1998
    const dec1998 = monthEndMap.get("1998-12") || { val: vals[0], date: dates[0] };
    let prevClose = dec1998;

    const rowsByYear = [];
    for (let y = firstYear; y <= lastYear; y++) {
      const months = new Array(12).fill(null);
      let yearStartClose = prevClose;
      let yearEndClose = null;

      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        const cur = monthEndMap.get(key);
        if (cur && prevClose) {
          const retPct = (cur.val / prevClose.val - 1) * 100;
          months[m - 1] = {
            retPct,
            startDate: prevClose.date,
            endDate: cur.date,
            startVal: prevClose.val,
            endVal: cur.val,
          };
          prevClose = cur;
          yearEndClose = cur;
        }
      }

      const yearTotalPct =
        yearEndClose && yearStartClose
          ? (yearEndClose.val / yearStartClose.val - 1) * 100
          : null;

      rowsByYear.push({
        year: y,
        months,
        yearTotalPct,
      });
    }

    // Estadísticas por columna (Ene..Dic y Total Año)
    const calcStats = (arr) => {
      if (!arr.length) return { mean: null, median: null, posRate: null };
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const posRate = (arr.filter((x) => x > 0).length / arr.length) * 100;
      return { mean, median, posRate };
    };

    const monthStats = [];
    for (let m = 0; m < 12; m++) {
      const colVals = rowsByYear
        .map((r) => (r.months[m] ? r.months[m].retPct : null))
        .filter((v) => v !== null);
      monthStats.push(calcStats(colVals));
    }

    const annualVals = rowsByYear
      .map((r) => r.yearTotalPct)
      .filter((v) => v !== null);
    const annualStats = calcStats(annualVals);

    return { rowsByYear, monthStats, annualStats };
  }

  function heatBgStyle(pct, maxScale = 10) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return "";
    const intensity = Math.min(1, Math.abs(pct) / maxScale);
    const alpha = (0.06 + intensity * 0.34).toFixed(3);
    if (pct > 0.005) {
      return `background-color: rgba(var(--heat-pos-rgb), ${alpha});`;
    }
    if (pct < -0.005) {
      return `background-color: rgba(var(--heat-neg-rgb), ${alpha});`;
    }
    return "";
  }

  function renderMonthlyTable() {
    const { rowsByYear, monthStats, annualStats } = computeMonthlyMatrix();
    const ordered = state.sortDesc ? [...rowsByYear].reverse() : rowsByYear;

    const bodyHtml = ordered
      .map((row) => {
        const isSelected = state.customYear === row.year;
        const cells = row.months
          .map((cell, mIdx) => {
            if (!cell) {
              return `<td class="cell-empty">—</td>`;
            }
            const style = heatBgStyle(cell.retPct, 10);
            const title = `${MONTH_NAMES_FULL[mIdx]} ${row.year}: ${fmtPct(
              cell.retPct,
              2,
              true
            )} (${fmtDateEs(cell.startDate)} → ${fmtDateEs(cell.endDate)})`;
            return `<td style="${style}" title="${title}">${fmtPct(
              cell.retPct,
              2,
              true
            )}</td>`;
          })
          .join("");

        const yrStyle = heatBgStyle(row.yearTotalPct, 25);
        const yrText =
          row.yearTotalPct !== null ? fmtPct(row.yearTotalPct, 2, true) : "—";
        const yrClass =
          row.yearTotalPct === null
            ? "total-col cell-empty"
            : `total-col ${row.yearTotalPct >= 0 ? "positive" : "negative"}`;

        return `
          <tr class="${isSelected ? "year-row-selected" : ""}">
            <th scope="row" class="sticky-col">
              <button type="button" class="year-btn" data-year="${
                row.year
              }" title="Ver detalle del año ${row.year} en el gráfico">
                ${row.year}
              </button>
            </th>
            ${cells}
            <td class="${yrClass}" style="${yrStyle}">${yrText}</td>
          </tr>
        `;
      })
      .join("");

    el.monthlyTableBody.innerHTML = bodyHtml;

    // Filas resumen en el pie de tabla: Media, Mediana y % Meses positivos
    const meanCells = monthStats
      .map(
        (s) =>
          `<td style="${heatBgStyle(s.mean, 4)}">${fmtPct(s.mean, 2, true)}</td>`
      )
      .join("");
    const medianCells = monthStats
      .map(
        (s) =>
          `<td style="${heatBgStyle(s.median, 4)}">${fmtPct(s.median, 2, true)}</td>`
      )
      .join("");
    const posCells = monthStats
      .map((s) => `<td>${s.posRate !== null ? Math.round(s.posRate) + "%" : "—"}</td>`)
      .join("");

    el.monthlyTableFoot.innerHTML = `
      <tr>
        <th scope="row" class="sticky-col" title="Promedio aritmético mensual desde 1999">Media</th>
        ${meanCells}
        <td class="total-col" style="${heatBgStyle(annualStats.mean, 12)}">${fmtPct(
      annualStats.mean,
      2,
      true
    )}</td>
      </tr>
      <tr>
        <th scope="row" class="sticky-col" title="Mediana histórica de cada mes desde 1999">Mediana</th>
        ${medianCells}
        <td class="total-col" style="${heatBgStyle(annualStats.median, 12)}">${fmtPct(
      annualStats.median,
      2,
      true
    )}</td>
      </tr>
      <tr>
        <th scope="row" class="sticky-col" title="Porcentaje de años con rentabilidad positiva en dicho mes">% Positivos</th>
        ${posCells}
        <td class="total-col">${
          annualStats.posRate !== null ? Math.round(annualStats.posRate) + "%" : "—"
        }</td>
      </tr>
    `;
  }

  function exportMonthlyCsv() {
    const { rowsByYear, monthStats, annualStats } = computeMonthlyMatrix();
    const lines = [
      ["Año", ...MONTH_NAMES_SHORT, "Total Año"].join(";"),
    ];
    for (const row of rowsByYear) {
      const vals = row.months.map((c) =>
        c ? c.retPct.toFixed(2).replace(".", ",") + "%" : ""
      );
      const yr =
        row.yearTotalPct !== null
          ? row.yearTotalPct.toFixed(2).replace(".", ",") + "%"
          : "";
      lines.push([row.year, ...vals, yr].join(";"));
    }
    lines.push(
      [
        "Media",
        ...monthStats.map((s) =>
          s.mean !== null ? s.mean.toFixed(2).replace(".", ",") + "%" : ""
        ),
        annualStats.mean !== null ? annualStats.mean.toFixed(2).replace(".", ",") + "%" : "",
      ].join(";")
    );

    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `msci_acwi_eur_mensual_${state.variant}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Actualización integral de toda la interfaz
  function refreshAll(rebuildTable = false) {
    state.hoverIndex = null;
    const slice = extractPeriodSlice();
    const kpis = computeKPIs(slice);
    renderHeroAndKPIs(slice, kpis);
    prepareAndDrawChart(slice, kpis);
    if (rebuildTable) {
      renderMonthlyTable();
    }
  }

  function renderFooterMeta() {
    const meta = state.raw.meta || {};
    const firstYear = state.raw.dates[0].slice(0, 4);
    const startBadgeYear = firstYear === "1998" ? "1999" : firstYear;
    const endYear = state.raw.dates[state.raw.dates.length - 1].slice(0, 4);
    el.headerHistoryBadge.textContent = `${startBadgeYear} – ${endYear}`;

    el.metaLastDate.textContent = fmtDateEs(meta.lastDate || state.raw.dates.at(-1));
    el.metaTotalDays.textContent = nfInt.format(state.raw.dates.length) + " días";

    const etf = meta.etfProxy || {};
    if (etf.lastPrice) {
      el.metaEtfPrice.textContent = `${nfNum2.format(etf.lastPrice)} €`;
    } else {
      el.metaEtfPrice.textContent = "IUSQ.DE (XETRA)";
    }

    if (meta.updatedAt) {
      el.metaUpdatedAt.textContent = fmtDateEs(meta.updatedAt);
    }
  }

  function setupInteractions() {
    // Tema claro / oscuro
    const savedTheme = localStorage.getItem("msci_acwi_theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      document.documentElement.setAttribute("data-theme", savedTheme);
    }
    el.themeToggleBtn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("msci_acwi_theme", next);
      drawCanvas();
    });

    // Selector Total Return vs Solo Precio
    document.querySelectorAll(".seg-btn[data-variant]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.variant;
        if (v === state.variant) return;
        state.variant = v;
        document
          .querySelectorAll(".seg-btn[data-variant]")
          .forEach((b) => b.classList.toggle("active", b === btn));
        refreshAll(true);
      });
    });

    // Botones de periodo (1D, 1S, 1M, YTD, 1A, 3A, 5A, 10A, 20A, Todo)
    document.querySelectorAll(".period-btn[data-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.customYear = null;
        state.period = btn.dataset.period;
        document
          .querySelectorAll(".period-btn[data-period]")
          .forEach((b) => b.classList.toggle("active", b === btn));
        renderMonthlyTable();
        refreshAll(false);
      });
    });

    // Salir de vista de año concreto
    el.clearCustomYearBtn.addEventListener("click", () => {
      state.customYear = null;
      document
        .querySelectorAll(".period-btn[data-period]")
        .forEach((b) => b.classList.toggle("active", b.dataset.period === state.period));
      renderMonthlyTable();
      refreshAll(false);
    });

    // Modo del gráfico (Valor / % / Drawdown)
    document.querySelectorAll(".mode-chip[data-chart-mode]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.chartMode = chip.dataset.chartMode;
        document
          .querySelectorAll(".mode-chip[data-chart-mode]")
          .forEach((c) => c.classList.toggle("active", c === chip));
        el.logToggleWrap.classList.toggle("disabled", state.chartMode !== "value");
        refreshAll(false);
      });
    });

    // Escala logarítmica
    el.logScaleCheckbox.addEventListener("change", () => {
      state.logScale = el.logScaleCheckbox.checked;
      refreshAll(false);
    });

    // Simulador de inversión en €
    el.investmentInput.addEventListener("input", () => {
      const val = parseFloat(el.investmentInput.value);
      if (Number.isFinite(val) && val > 0) {
        state.initialInvestment = val;
        refreshAll(false);
      }
    });

    // Ordenar tabla mensual y exportar CSV
    el.sortYearBtn.addEventListener("click", () => {
      state.sortDesc = !state.sortDesc;
      el.sortYearLabel.textContent = state.sortDesc
        ? "Recientes primero ↓"
        : "1999 primero ↑";
      renderMonthlyTable();
    });

    el.downloadCsvBtn.addEventListener("click", exportMonthlyCsv);

    // Clic sobre un año de la tabla mensual
    el.monthlyTableBody.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".year-btn");
      if (!btn) return;
      const yr = Number(btn.dataset.year);
      if (!Number.isFinite(yr)) return;

      if (state.customYear === yr) {
        state.customYear = null;
        document
          .querySelectorAll(".period-btn[data-period]")
          .forEach((b) => b.classList.toggle("active", b.dataset.period === state.period));
      } else {
        state.customYear = yr;
        document
          .querySelectorAll(".period-btn[data-period]")
          .forEach((b) => b.classList.remove("active"));
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      renderMonthlyTable();
      refreshAll(false);
    });

    // Eventos de ratón y táctiles en el gráfico
    const handlePointer = (clientX) => {
      if (!state.currentPlot) return;
      const rect = el.canvas.getBoundingClientRect();
      const width = rect.width;
      const padLeft = width < 520 ? 8 : 12;
      const padRight = width < 520 ? 58 : 74;
      const plotW = Math.max(1, width - padLeft - padRight);
      const relX = Math.max(0, Math.min(1, (clientX - rect.left - padLeft) / plotW));
      const m = state.currentPlot.displaySeries.length;
      const idx = Math.round(relX * (m - 1));
      if (idx !== state.hoverIndex) {
        state.hoverIndex = idx;
        drawCanvas();
      }
    };

    el.canvas.addEventListener("mousemove", (e) => handlePointer(e.clientX));
    el.canvas.addEventListener("mouseleave", () => {
      state.hoverIndex = null;
      drawCanvas();
    });
    el.canvas.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length > 0) {
          handlePointer(e.touches[0].clientX);
        }
      },
      { passive: true }
    );
    el.canvas.addEventListener("touchend", () => {
      state.hoverIndex = null;
      drawCanvas();
    });

    const ro = new ResizeObserver(() => {
      drawCanvas();
    });
    ro.observe(el.chartContainer);
  }

  async function init() {
    setupInteractions();
    try {
      const resp = await fetch("data/msci_acwi_eur.json", { cache: "no-cache" });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (!data || !Array.isArray(data.dates) || data.dates.length < 2) {
        throw new Error("Formato de datos inválido.");
      }

      state.raw = data;
      el.statusBanner.classList.add("hidden");
      el.mainContent.classList.remove("hidden");

      renderFooterMeta();
      refreshAll(true);
    } catch (err) {
      el.statusBanner.textContent = `No se pudieron cargar los datos históricos (${err.message}).`;
      el.statusBanner.classList.add("error");
    }
  }

  init();
})();
