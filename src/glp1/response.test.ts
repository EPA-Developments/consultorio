import {
  assessResponse,
  baselineFor,
  metricResponse,
  normalizeSeries,
  UMBRAL_RESPUESTA_PORCENTUAL,
} from './response';
import type { DatedValue, ResponseInputs } from './response';

const INICIO = '2026-08-06T12:00:00.000Z';

/** Serie de peso a partir de pares [díaDesdeElInicio, kg]. */
function serie(pares: [number, number][], unit = 'kg'): DatedValue[] {
  return pares.map(([dias, value]) => ({
    date: new Date(new Date(INICIO).getTime() + dias * 24 * 3600 * 1000).toISOString(),
    value,
    unit,
  }));
}

function inputs(extra: Partial<ResponseInputs> = {}): ResponseInputs {
  return {
    series: { peso: serie([[-7, 100]]) },
    planStartIso: INICIO,
    reviewWeeks: 20,
    nowIso: new Date(new Date(INICIO).getTime() + 140 * 24 * 3600 * 1000).toISOString(), // semana 20
    ...extra,
  };
}

describe('normalizeSeries', () => {
  test('ordena de más viejo a más nuevo', () => {
    const s = normalizeSeries([
      { date: '2026-03-01', value: 2 },
      { date: '2026-01-01', value: 1 },
      { date: '2026-02-01', value: 3 },
    ]);
    expect(s.map((p) => p.value)).toStrictEqual([1, 3, 2]);
  });

  test('descarta lo que no tenga fecha o valor usable', () => {
    const s = normalizeSeries([
      { value: 5 },
      { date: '2026-01-01', value: Number.NaN },
      { date: '2026-01-02', value: 7 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].value).toBe(7);
  });
});

describe('baselineFor', () => {
  // El basal es el del PLAN, no el valor más viejo de la historia clínica.
  test('toma la última medición previa al inicio, no la más vieja de todas', () => {
    const s = serie([
      [-400, 88], // el año pasado, irrelevante
      [-30, 102],
      [-3, 100],
      [30, 96],
    ]);
    expect(baselineFor(s, INICIO)?.value).toBe(100);
  });

  test('una medición exactamente en la fecha de inicio cuenta como basal', () => {
    expect(baselineFor(serie([[0, 100], [30, 95]]), INICIO)?.value).toBe(100);
  });

  test('sin mediciones previas cae a la primera posterior', () => {
    expect(baselineFor(serie([[10, 99], [40, 95]]), INICIO)?.value).toBe(99);
  });

  test('serie vacía: sin basal', () => {
    expect(baselineFor([], INICIO)).toBeUndefined();
  });
});

describe('metricResponse', () => {
  test('calcula el cambio absoluto y porcentual contra el basal', () => {
    const m = metricResponse('peso', serie([[-3, 100], [90, 92]]), INICIO);
    expect(m.baseline?.value).toBe(100);
    expect(m.latest?.value).toBe(92);
    expect(m.absoluteChange).toBe(-8);
    expect(m.percentChange).toBeCloseTo(-8, 5);
    expect(m.improving).toBe(true);
  });

  // Con un solo punto, basal y último son el mismo: informar 0 % daría a
  // entender que hubo dos mediciones y que no cambió nada.
  test('con una sola medición no inventa un cambio de 0 %', () => {
    const m = metricResponse('peso', serie([[-3, 100]]), INICIO);
    expect(m.baseline?.value).toBe(100);
    expect(m.percentChange).toBeUndefined();
    expect(m.absoluteChange).toBeUndefined();
  });

  test('subir de peso no cuenta como mejora', () => {
    expect(metricResponse('peso', serie([[-3, 100], [60, 104]]), INICIO).improving).toBe(false);
  });

  test('la HbA1c también mejora bajando', () => {
    const m = metricResponse('hba1c', serie([[-3, 8.2], [90, 6.9]], '%'), INICIO);
    expect(m.improving).toBe(true);
    expect(m.unit).toBe('%');
  });

  test('serie vacía no rompe', () => {
    expect(metricResponse('cintura', [], INICIO)).toMatchObject({ points: [], baseline: undefined });
  });
});

describe('assessResponse — veredicto', () => {
  test('sin mediciones: sin datos, no "no responde"', () => {
    const r = assessResponse(inputs({ series: {} }));
    expect(r.verdict).toBe('sin-datos');
  });

  test('con una sola medición todavía no se puede comparar', () => {
    expect(assessResponse(inputs()).verdict).toBe('sin-basal');
  });

  // Lo importante de la opción C: no dictaminar mientras se está escalando.
  test('antes de la fecha de revisión el veredicto es "en curso"', () => {
    const r = assessResponse(
      inputs({
        series: { peso: serie([[-3, 100], [60, 98]]) },
        nowIso: new Date(new Date(INICIO).getTime() + 60 * 24 * 3600 * 1000).toISOString(),
      })
    );
    expect(r.verdict).toBe('en-curso');
    expect(r.reviewReached).toBe(false);
    expect(r.weeksToReview).toBeGreaterThan(0);
    expect(r.message).toMatch(/pronto para juzgar/);
  });

  test('bajando poco pero todavía en curso, no dice que no responde', () => {
    const r = assessResponse(
      inputs({
        series: { peso: serie([[-3, 100], [28, 99]]) },
        nowIso: new Date(new Date(INICIO).getTime() + 28 * 24 * 3600 * 1000).toISOString(),
      })
    );
    expect(r.verdict).toBe('en-curso');
  });

  test('llegada la revisión con ≥5 %: responde', () => {
    const r = assessResponse(inputs({ series: { peso: serie([[-3, 100], [140, 93]]) } }));
    expect(r.verdict).toBe('responde');
    expect(r.weightLossPercent).toBeCloseTo(7, 5);
    expect(r.reviewReached).toBe(true);
  });

  test('llegada la revisión con <5 %: sin respuesta suficiente, pero invita a revisar', () => {
    const r = assessResponse(inputs({ series: { peso: serie([[-3, 100], [140, 97]]) } }));
    expect(r.verdict).toBe('no-responde');
    expect(r.message).toMatch(/revisar antes de concluir/);
  });

  test('el umbral es 5 % y justo en 5 % cuenta como respuesta', () => {
    expect(UMBRAL_RESPUESTA_PORCENTUAL).toBe(5);
    expect(assessResponse(inputs({ series: { peso: serie([[-3, 100], [140, 95]]) } })).verdict).toBe('responde');
  });

  test('si subió de peso, la pérdida es negativa y no cumple', () => {
    const r = assessResponse(inputs({ series: { peso: serie([[-3, 100], [140, 103]]) } }));
    expect(r.weightLossPercent).toBeCloseTo(-3, 5);
    expect(r.verdict).toBe('no-responde');
  });
});

describe('assessResponse — de dónde sale la pérdida ponderal', () => {
  test('usa el peso cuando está', () => {
    const r = assessResponse(
      inputs({
        series: { peso: serie([[-3, 100], [140, 92]]), imc: serie([[-3, 33], [140, 30]], 'kg/m2') },
      })
    );
    expect(r.weightLossSource).toBe('peso');
    expect(r.weightLossPercent).toBeCloseTo(8, 5);
  });

  // El % de cambio del IMC equivale al del peso mientras la talla no cambie.
  test('cae al IMC si no se registró el peso, y lo deja dicho', () => {
    const r = assessResponse(inputs({ series: { imc: serie([[-3, 32], [140, 29]], 'kg/m2') } }));
    expect(r.weightLossSource).toBe('imc');
    expect(r.weightLossPercent).toBeCloseTo(9.375, 3);
    expect(r.verdict).toBe('responde');
  });

  test('cintura y HbA1c solas no alcanzan para el veredicto ponderal', () => {
    const r = assessResponse(
      inputs({ series: { cintura: serie([[-3, 110], [140, 100]], 'cm'), hba1c: serie([[-3, 8], [140, 6.5]], '%') } })
    );
    expect(r.verdict).toBe('sin-basal');
    // Pero las métricas igual se muestran: sirven aunque no definan el veredicto.
    expect(r.metrics.map((m) => m.id).sort()).toStrictEqual(['cintura', 'hba1c']);
  });
});

describe('assessResponse — la fecha de revisión sale del protocolo', () => {
  test('reviewWeeks 12 y 20 dan fechas distintas', () => {
    const a = assessResponse(inputs({ reviewWeeks: 12 }));
    const b = assessResponse(inputs({ reviewWeeks: 20 }));
    expect(a.reviewDate < b.reviewDate).toBe(true);
    expect(a.reviewDate.slice(0, 10)).toBe('2026-10-29');
    expect(b.reviewDate.slice(0, 10)).toBe('2026-12-24');
  });

  test('con revisión a la semana 12 el mismo caso ya tiene veredicto', () => {
    const serieCorta = { peso: serie([[-3, 100], [90, 93]]) };
    const ahora = new Date(new Date(INICIO).getTime() + 90 * 24 * 3600 * 1000).toISOString();
    expect(assessResponse(inputs({ series: serieCorta, reviewWeeks: 12, nowIso: ahora })).verdict).toBe('responde');
    expect(assessResponse(inputs({ series: serieCorta, reviewWeeks: 20, nowIso: ahora })).verdict).toBe('en-curso');
  });
});

describe('assessResponse — métricas que se muestran', () => {
  test('solo aparecen las que tienen alguna medición', () => {
    const r = assessResponse(
      inputs({ series: { peso: serie([[-3, 100], [140, 92]]), cintura: [], hba1c: serie([[0, 7.4]], '%') } })
    );
    expect(r.metrics.map((m) => m.id).sort()).toStrictEqual(['hba1c', 'peso']);
  });
});
