import type { Bundle, Observation, ObservationDefinition } from '@medplum/fhirtypes';
import bundleJson from '../../data/ckm/biomarker-definitions.json';
import {
  classifyBiomarkerValue,
  getBiomarkerDefinitions,
  groupByPanel,
  indexByBiomarcador,
  indexByLoinc,
  latestValueByCode,
  parseObservationDefinition,
  rangeForGender,
  valuesByCodeHistory,
} from './observation-definitions';

const bundle = bundleJson as unknown as Bundle;
const defs = (bundle.entry ?? [])
  .map((e) => e.resource as ObservationDefinition)
  .filter((r) => r?.resourceType === 'ObservationDefinition')
  .map(parseObservationDefinition);

const byId = indexByBiomarcador(defs);

describe('parseObservationDefinition — sobre el bundle real', () => {
  test('parsea las 109 definiciones del bundle', () => {
    expect(defs).toHaveLength(109);
  });

  test('ApoB: LOINC, panel lipídico, rangos óptimo/convencional', () => {
    const apob = byId.get('apob')!;
    expect(apob).toMatchObject({
      label: 'Apolipoproteína B',
      code: '1884-6',
      system: 'http://loinc.org',
      panelCode: 'lipidico',
    });
    expect(apob.optimal[0]?.high).toBe(90);
    expect(apob.conventional[0]?.high).toBe(100);
  });

  // La mayoría del catálogo marca el rango convencional con el código
  // 'convencional'; solo las definiciones más viejas usan 'normal'. Si el
  // lector deja de aceptar los dos, el panel se queda sin referencia dura y
  // clasifica contra el óptimo, que es mucho más angosto.
  test('lee el rango convencional escrito con cualquiera de los dos códigos', () => {
    const conCodigoNuevo = byId.get('glucosa-en-ayunas')!; // 'convencional'
    const conCodigoViejo = byId.get('fructosamina')!; // 'normal'
    expect(conCodigoNuevo.conventional.length).toBeGreaterThan(0);
    expect(conCodigoViejo.conventional.length).toBeGreaterThan(0);

    // Los únicos sin rango convencional son marcadores funcionales que no
    // tienen referencia de laboratorio: solo se los mira contra el óptimo.
    const sinConvencional = defs.filter((d) => d.optimal.length > 0 && d.conventional.length === 0);
    expect(sinConvencional.map((d) => d.biomarcadorId).sort()).toStrictEqual([
      'dunedinpace-velocidad-envejecimiento',
      'hrv-variabilidad-frecuencia-cardiaca',
      'omega-3-epa-plus-dha-indice',
      'pic-ratio-aa-epa-perfil-de-inflamacion-celular',
    ]);
  });

  test('Lp(a): rangos 50 (óptimo) / 75 (convencional) nmol/L', () => {
    const lpa = byId.get('lpa')!;
    expect(lpa.optimal[0]?.high).toBe(50);
    expect(lpa.conventional[0]?.high).toBe(75);
    expect(lpa.unit).toBeDefined();
  });

  test('captura interpretación y fuente de las extensiones', () => {
    const omega3 = byId.get('omega-3-epa-plus-dha-indice')!;
    expect(omega3.interpretation).toMatch(/omega-3/i);
    expect(omega3.source).toBeTruthy();
  });

  // Solo 15 de las 109 definiciones traen texto de interpretación y fuente: las
  // que se sumaron después se cargaron sin esas extensiones. No es un problema
  // del lector, es un hueco de contenido del catálogo.
  test('deja registrado cuántas definiciones traen interpretación', () => {
    expect(defs.filter((d) => d.interpretation).length).toBe(15);
  });

  test('rangos por género: ácido úrico tiene convencional male/female y óptimo sin género', () => {
    const au = byId.get('acido-urico')!;
    expect(au.conventional.find((r) => r.gender === 'male')).toMatchObject({ low: 3.4, high: 7 });
    expect(au.conventional.find((r) => r.gender === 'female')).toMatchObject({ low: 2.4, high: 6 });
    expect(rangeForGender(au.conventional, 'female')).toMatchObject({ high: 6 });
    // óptimo no tiene género -> rangeForGender cae al no-especificado
    expect(rangeForGender(au.optimal, 'male')).toMatchObject({ low: 3.5, high: 5.5 });
  });

  test('todas las definiciones tienen panel y label', () => {
    for (const def of defs) {
      expect(def.label).toBeTruthy();
      expect(def.panelCode).toBeTruthy();
    }
  });
});

describe('rangeForGender', () => {
  test('lista vacía -> undefined', () => {
    expect(rangeForGender([])).toBeUndefined();
  });
  test('sin match de género cae al no-especificado', () => {
    expect(rangeForGender([{ high: 10 }, { high: 5, gender: 'male' }], 'female')).toMatchObject({ high: 10 });
  });
  test('sin no-especificado ni match cae al primero', () => {
    expect(rangeForGender([{ high: 7, gender: 'male' }], 'female')).toMatchObject({ high: 7 });
  });
});

describe('índices', () => {
  test('indexByLoinc solo incluye códigos LOINC', () => {
    const byLoinc = indexByLoinc(defs);
    expect(byLoinc.get('1884-6')?.label).toBe('Apolipoproteína B');
    // HOMA-IR usa código local, no debe estar indexado por LOINC
    expect([...byLoinc.values()].some((d) => d.label === 'HOMA-IR')).toBe(false);
  });

  test('indexByBiomarcador cubre todos los slugs presentes', () => {
    expect(byId.size).toBe(defs.filter((d) => d.biomarcadorId).length);
    expect(byId.has('homa-ir')).toBe(true);
  });
});

describe('getBiomarkerDefinitions', () => {
  test('mapea las ObservationDefinitions del cliente', async () => {
    const fakeMedplum = {
      searchResources: async () =>
        (bundle.entry ?? []).map((e) => e.resource as ObservationDefinition).slice(0, 3),
    } as unknown as Parameters<typeof getBiomarkerDefinitions>[0];
    const result = await getBiomarkerDefinitions(fakeMedplum);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBeTruthy();
  });

  test('filtra por sistema en el cliente: descarta ODs ajenas / sin identifier de biomarcador', async () => {
    const propias = (bundle.entry ?? []).map((e) => e.resource as ObservationDefinition).slice(0, 3);
    const ajena: ObservationDefinition = {
      resourceType: 'ObservationDefinition',
      identifier: [{ system: 'https://otro-equipo.example/fhir/sid/marcador', value: 'x' }],
      code: { text: 'Marcador ajeno' },
    };
    const sinIdentifier: ObservationDefinition = { resourceType: 'ObservationDefinition', code: { text: 'Sin id' } };
    // El server devuelve un mix (la query no acota por identifier); el filtro de
    // cliente debe quedarse solo con las 3 ODs del sistema de biomarcador.
    const fakeMedplum = {
      searchResources: async () => [ajena, ...propias, sinIdentifier],
    } as unknown as Parameters<typeof getBiomarkerDefinitions>[0];
    const result = await getBiomarkerDefinitions(fakeMedplum);
    expect(result).toHaveLength(3);
    expect(result.every((d) => d.biomarcadorId)).toBe(true);
  });
});

describe('classifyBiomarkerValue', () => {
  test('cota superior (glucosa: óptimo 75–85, convencional 70–100)', () => {
    const glu = byId.get('glucosa-en-ayunas')!;
    expect(classifyBiomarkerValue(glu, 80).status).toBe('optimal');
    expect(classifyBiomarkerValue(glu, 92).status).toBe('normal');
    expect(classifyBiomarkerValue(glu, 120).status).toBe('high');
    expect(classifyBiomarkerValue(glu, 65).status).toBe('low');
  });

  test('cota inferior por género (HDL: óptimo ≥60, convencional ≥40 H)', () => {
    const hdl = byId.get('hdl-colesterol')!;
    expect(classifyBiomarkerValue(hdl, 70, 'male').status).toBe('optimal');
    expect(classifyBiomarkerValue(hdl, 45, 'male').status).toBe('normal');
    expect(classifyBiomarkerValue(hdl, 35, 'male').status).toBe('low');
  });

  test('doble cola con rango por género (ácido úrico)', () => {
    const au = byId.get('acido-urico')!;
    expect(classifyBiomarkerValue(au, 4, 'male').status).toBe('optimal'); // óptimo 3.5–5.5
    expect(classifyBiomarkerValue(au, 6.8, 'male').status).toBe('normal'); // convencional H ≤7.2
    expect(classifyBiomarkerValue(au, 8, 'male').status).toBe('high');
    expect(classifyBiomarkerValue(au, 6.5, 'female').status).toBe('high'); // convencional M ≤6
  });

  test('valor ausente -> unknown con etiqueta —', () => {
    const glu = byId.get('glucosa-en-ayunas')!;
    expect(classifyBiomarkerValue(glu, undefined)).toMatchObject({ status: 'unknown', label: '—' });
  });
});

describe('classifyBiomarkerValue — óptimo de una cola vs óptimo que excede el convencional', () => {
  test('Hb: óptimo de una sola cola (≥14) NO tapa el tope convencional (18 -> Alto)', () => {
    const hb = byId.get('hemoglobina')!; // conv male 13.5–17.5, óptimo male ≥14 (sin tope)
    expect(classifyBiomarkerValue(hb, 18, 'male').status).toBe('high');
    expect(classifyBiomarkerValue(hb, 14.5, 'male').status).toBe('optimal');
    expect(classifyBiomarkerValue(hb, 13.8, 'male').status).toBe('normal');
    // Convencional y óptimo son por género: 13 queda por debajo del convencional
    // del varón (13,5) pero es exactamente el piso del óptimo de la mujer.
    expect(classifyBiomarkerValue(hb, 13, 'male').status).toBe('low');
    expect(classifyBiomarkerValue(hb, 13, 'female').status).toBe('optimal');
    expect(classifyBiomarkerValue(hb, 12.5, 'female').status).toBe('normal');
  });

  test('óptimo que excede el tope convencional: el valor on-target es Óptimo, no Alto', () => {
    const t3 = byId.get('t3-libre')!; // conv 2.3–4.2, óptimo 3.5–4.5
    expect(classifyBiomarkerValue(t3, 4.4).status).toBe('optimal');
    expect(classifyBiomarkerValue(t3, 4.6).status).toBe('high'); // fuera del óptimo acotado

    const dhea = byId.get('dhea-s')!; // conv male 80–560, óptimo male 350–500
    expect(classifyBiomarkerValue(dhea, 470, 'male').status).toBe('optimal');

    const testo = byId.get('testosterona-libre')!; // conv 38–190, óptimo male 150–250 pg/mL
    expect(classifyBiomarkerValue(testo, 230, 'male').status).toBe('optimal');
  });
});

describe('parseObservationDefinition — fallbacks y OD incompleta', () => {
  test('label cae a coding.display y luego a coding.code', () => {
    const withDisplay = parseObservationDefinition({
      resourceType: 'ObservationDefinition',
      code: { coding: [{ code: 'C1', display: 'Disp' }] },
    } as ObservationDefinition);
    expect(withDisplay.label).toBe('Disp');

    const onlyCode = parseObservationDefinition({
      resourceType: 'ObservationDefinition',
      code: { coding: [{ code: 'C2' }] },
    } as ObservationDefinition);
    expect(onlyCode.label).toBe('C2');
  });

  test('OD vacía: label "(sin nombre)", rangos vacíos, sin throw', () => {
    const def = parseObservationDefinition({ resourceType: 'ObservationDefinition' } as unknown as ObservationDefinition);
    expect(def).toMatchObject({
      label: '(sin nombre)',
      conventional: [],
      optimal: [],
      code: undefined,
      panelCode: undefined,
    });
  });
});

function obs(code: string, value: number | undefined, date: string, status: Observation['status'] = 'final'): Observation {
  return {
    resourceType: 'Observation',
    status,
    code: { coding: [{ system: 'http://loinc.org', code }] },
    effectiveDateTime: date,
    ...(value !== undefined ? { valueQuantity: { value, unit: 'mg/dL' } } : {}),
  };
}

describe('latestValueByCode', () => {
  test('toma el último valor por código, ignora entered-in-error y sin valor', () => {
    const map = latestValueByCode([
      obs('1558-6', 90, '2026-01-01'),
      obs('1558-6', 84, '2026-06-01'), // más nuevo gana
      obs('2085-9', 200, '2026-06-10', 'entered-in-error'),
      obs('2085-9', undefined, '2026-06-09'),
      obs('2085-9', 58, '2026-06-08'),
    ]);
    expect(map.get('1558-6')?.value).toBe(84);
    expect(map.get('2085-9')?.value).toBe(58);
  });
});

describe('valuesByCodeHistory', () => {
  test('historial por código, de más viejo a más nuevo, sin entered-in-error', () => {
    const map = valuesByCodeHistory([
      obs('1558-6', 84, '2026-06-01'),
      obs('1558-6', 90, '2026-01-01'),
      obs('1558-6', 88, '2026-03-01'),
      obs('2085-9', 200, '2026-06-10', 'entered-in-error'),
      obs('2085-9', undefined, '2026-06-09'),
    ]);
    expect(map.get('1558-6')?.map((v) => v.value)).toStrictEqual([90, 88, 84]);
    expect(map.has('2085-9')).toBe(false);
  });
});

describe('groupByPanel', () => {
  test('agrupa por panel con el orden CV primero', () => {
    const groups = groupByPanel(defs);
    expect(groups.slice(0, 3).map((g) => g.panelCode)).toStrictEqual(['metabolico', 'lipidico', 'inflamacion']);
    expect(groups.every((g) => g.panelDisplay && g.defs.length > 0)).toBe(true);
    expect(groups.reduce((n, g) => n + g.defs.length, 0)).toBe(109);
  });
});
