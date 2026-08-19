import type { ObservationDefinition } from '@medplum/fhirtypes';
import biomarkerBundle from '../../data/ckm/biomarker-definitions.json';
import type { BiomarkerDefinition } from '../ckm/observation-definitions';
import { LOINC_SYSTEM, parseObservationDefinition } from '../ckm/observation-definitions';
import {
  approveProposals,
  buildLabOrder,
  chunk,
  groupByRequisition,
  LABORATORY_CATEGORY,
  MAX_WRITES_PER_TX,
  ORDERABILITY_INFO,
  orderabilityFor,
  panelDelPreset,
  REQUISITION_SYSTEM,
  resolveDerivedSources,
  toLabOrderItems,
} from './lab-order';

const LOCAL_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/biomarcador-local';

function def(partial: Partial<BiomarkerDefinition>): BiomarkerDefinition {
  return {
    label: partial.label ?? 'Marcador',
    biomarcadorId: partial.biomarcadorId,
    code: partial.code,
    system: partial.system,
    panelCode: partial.panelCode,
    panelDisplay: partial.panelDisplay,
    conventional: [],
    optimal: [],
    ...partial,
  };
}

const glucosa = def({
  biomarcadorId: 'glucosa-en-ayunas',
  label: 'Glucosa en Ayunas',
  code: '1558-6',
  system: LOINC_SYSTEM,
  panelCode: 'metabolico',
  panelDisplay: 'Metabolismo',
});
// Código real del catálogo (insulina basal): las fuentes de los derivados se
// declaran por LOINC, así que el fixture tiene que usar el mismo.
const insulina = def({ biomarcadorId: 'insulina-en-ayunas', label: 'Insulina', code: '20448-7', system: LOINC_SYSTEM });
// Los derivados los marca el CATÁLOGO, no una lista en el código: el fixture
// tiene que traer las dos extensiones, igual que el recurso del servidor.
const homaIr = def({
  biomarcadorId: 'homa-ir',
  label: 'HOMA-IR',
  code: 'homa-ir',
  system: LOCAL_SYSTEM,
  noSolicitable: true,
  formulaDerivado: 'glucosa × insulina / 405',
});
const creatinina = def({ biomarcadorId: 'creatinina', label: 'Creatinina', code: '2160-0', system: LOINC_SYSTEM });
const egfr = def({
  biomarcadorId: 'egfr-tfg-estimada',
  label: 'eGFR',
  code: '98979-8',
  system: LOINC_SYSTEM,
  noSolicitable: true,
  formulaDerivado: 'CKD-EPI',
});
// Un analito del hemograma: medido, no calculado, y aun así no se pide suelto.
const hemoglobina = def({
  biomarcadorId: 'hemoglobina',
  label: 'Hemoglobina',
  code: '718-7',
  system: LOINC_SYSTEM,
  panelCode: 'hemograma',
  noSolicitable: true,
});
const edadBiologica = def({
  biomarcadorId: 'edad-biologica-metilacion-adn',
  label: 'Edad Biológica',
  code: 'edad-biologica-epigenetica',
  system: LOCAL_SYSTEM,
});
const hrv = def({
  biomarcadorId: 'hrv-variabilidad-frecuencia-cardiaca',
  label: 'HRV',
  code: 'hrv-rmssd',
  system: LOCAL_SYSTEM,
});

describe('Clasificación de solicitabilidad', () => {
  test('marcador con LOINC de rutina → lab', () => {
    expect(orderabilityFor(glucosa)).toBe('lab');
  });

  test('marcador con código local (sin LOINC) → especializado', () => {
    expect(orderabilityFor(edadBiologica)).toBe('specialized');
  });

  test('HOMA-IR → derivado (aunque tenga código local)', () => {
    expect(orderabilityFor(homaIr)).toBe('derived');
  });

  test('eGFR → derivado aunque tenga LOINC (se calcula de creatinina)', () => {
    expect(orderabilityFor(egfr)).toBe('derived');
  });

  test('HRV → dispositivo', () => {
    expect(orderabilityFor(hrv)).toBe('device');
  });

  // Sin esta categoría había que elegir entre dejarlo pedible o llamarlo
  // "calculado", y la hemoglobina no es ninguna de las dos: es medida y viene
  // adentro del hemograma.
  test('analito de panel → componente, no derivado', () => {
    expect(orderabilityFor(hemoglobina)).toBe('component');
  });

  test('el dispositivo gana sobre no-solicitable', () => {
    expect(orderabilityFor({ ...hrv, noSolicitable: true })).toBe('device');
  });

  test('LOINC ausente pero código local presente igual es especializado', () => {
    expect(orderabilityFor(def({ biomarcadorId: 'zonulina', code: 'zonulina', system: LOCAL_SYSTEM }))).toBe(
      'specialized'
    );
  });
});

// El bug que motivó todo esto: la lista hardcodeada tenía dos entradas y el
// catálogo marca 31. El dashboard dejaba emitir órdenes pidiendo "Colesterol
// NO-HDL" o "Basófilos", que ningún laboratorio procesa sueltos.
describe('La solicitabilidad sale del catálogo real, no de una lista paralela', () => {
  const defs = (biomarkerBundle.entry as { resource: ObservationDefinition }[]).map((e) =>
    parseObservationDefinition(e.resource)
  );
  const byId = new Map(defs.map((d) => [d.biomarcadorId, d]));

  test('ningún marcado no-solicitable en el catálogo queda pedible', () => {
    const pedibles = defs.filter((d) => d.noSolicitable && ORDERABILITY_INFO[orderabilityFor(d)].orderable);
    expect(pedibles.map((d) => d.biomarcadorId)).toStrictEqual([]);
  });

  test('los seis derivados que el portal reportó no se pueden pedir', () => {
    const derivados = [
      'colesterol-no-hdl',
      'ratio-psa-libre-total',
      'saturacion-transferrina',
      'ratio-zinc-cobre',
      'homa-ir',
      'egfr-tfg-estimada',
    ];
    for (const id of derivados) {
      const d = byId.get(id);
      expect(d, `falta ${id} en el catálogo`).toBeDefined();
      expect(orderabilityFor(d as BiomarkerDefinition), id).toBe('derived');
    }
  });

  test('el hemograma se clasifica como componente, no como calculado', () => {
    expect(orderabilityFor(byId.get('hemoglobina') as BiomarkerDefinition)).toBe('component');
    expect(orderabilityFor(byId.get('plaquetas') as BiomarkerDefinition)).toBe('component');
  });

  // El HRV no trae la extensión: si la clasificación dependiera solo del
  // catálogo, un wearable volvería a ser solicitable.
  test('el HRV sigue siendo dispositivo aunque el catálogo no lo marque', () => {
    const hrvReal = byId.get('hrv-variabilidad-frecuencia-cardiaca') as BiomarkerDefinition;
    expect(hrvReal.noSolicitable).toBeUndefined();
    expect(orderabilityFor(hrvReal)).toBe('device');
  });

  test('lo que sí es solicitable sigue siéndolo', () => {
    expect(orderabilityFor(byId.get('glucosa-en-ayunas') as BiomarkerDefinition)).toBe('lab');
  });
});

describe('Normalización a ítems de orden', () => {
  const items = toLabOrderItems([glucosa, homaIr, egfr, edadBiologica, hrv]);

  test('marca orderable según la clasificación', () => {
    const byId = new Map(items.map((i) => [i.biomarcadorId, i]));
    expect(byId.get('glucosa-en-ayunas')?.orderable).toBe(true);
    expect(byId.get('edad-biologica-metilacion-adn')?.orderable).toBe(true); // especializado sí es solicitable
    expect(byId.get('homa-ir')?.orderable).toBe(false);
    expect(byId.get('egfr-tfg-estimada')?.orderable).toBe(false);
    expect(byId.get('hrv-variabilidad-frecuencia-cardiaca')?.orderable).toBe(false);
  });

  test('expone las fuentes de los derivados (por código LOINC)', () => {
    const byId = new Map(items.map((i) => [i.biomarcadorId, i]));
    expect(byId.get('egfr-tfg-estimada')?.derivedFrom).toEqual(['2160-0']); // creatinina
    expect(byId.get('homa-ir')?.derivedFrom).toEqual(['1558-6', '20448-7']); // glucosa + insulina
    expect(byId.get('glucosa-en-ayunas')?.derivedFrom).toBeUndefined();
  });
});

describe('resolveDerivedSources', () => {
  const catalog = toLabOrderItems([glucosa, insulina, homaIr, creatinina, egfr]);

  test('elegir un derivado agrega su fuente', () => {
    expect(resolveDerivedSources(['egfr-tfg-estimada'], catalog)).toEqual(['egfr-tfg-estimada', 'creatinina']);
  });

  test('no duplica si la fuente ya estaba seleccionada', () => {
    const out = resolveDerivedSources(['homa-ir', 'glucosa-en-ayunas'], catalog);
    expect(out).toEqual(['homa-ir', 'glucosa-en-ayunas', 'insulina-en-ayunas']);
  });

  test('selección sin derivados se devuelve intacta', () => {
    expect(resolveDerivedSources(['glucosa-en-ayunas'], catalog)).toEqual(['glucosa-en-ayunas']);
  });
});

describe('buildLabOrder', () => {
  const subject = { reference: 'Patient/p1' };
  const requester = { reference: 'Practitioner/dr1', display: 'Dra. X' };
  const items = toLabOrderItems([glucosa, insulina, egfr, hrv]);
  const base = { subject, requester, items, requisitionId: 'ORD-001', authoredOn: '2026-07-23T10:00:00Z' };

  test('crea un ServiceRequest por análisis solicitable, omitiendo derivados/dispositivo', () => {
    const orders = buildLabOrder(base);
    // glucosa + insulina (lab); eGFR (derivado) y HRV (dispositivo) se omiten.
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.code?.text).sort()).toEqual(['Glucosa en Ayunas', 'Insulina']);
  });

  test('todos comparten la misma requisición', () => {
    const orders = buildLabOrder(base);
    for (const o of orders) {
      expect(o.requisition).toEqual({ system: REQUISITION_SYSTEM, value: 'ORD-001' });
    }
  });

  test('el flujo médico (order) queda status active', () => {
    const orders = buildLabOrder(base);
    expect(orders[0]).toMatchObject({ intent: 'order', status: 'active', priority: 'routine' });
    expect(orders[0].category).toEqual([LABORATORY_CATEGORY]);
    expect(orders[0].requester).toEqual(requester);
  });

  test('el flujo del paciente (proposal) queda status draft', () => {
    const orders = buildLabOrder({ ...base, intent: 'proposal', requester: { reference: 'Patient/p1' } });
    expect(orders[0]).toMatchObject({ intent: 'proposal', status: 'draft' });
  });

  test('el código LOINC del análisis viaja en code.coding', () => {
    const orders = buildLabOrder(base);
    const glucosaOrder = orders.find((o) => o.code?.text === 'Glucosa en Ayunas');
    expect(glucosaOrder?.code?.coding?.[0]).toEqual({
      system: LOINC_SYSTEM,
      code: '1558-6',
      display: 'Glucosa en Ayunas',
    });
  });

  test('la nota (ej. cobertura) se adjunta a cada orden', () => {
    const orders = buildLabOrder({ ...base, notas: ['OSDE 210 · ayuno 12 h'] });
    expect(orders[0].note).toEqual([{ text: 'OSDE 210 · ayuno 12 h' }]);
  });

  test('un ítem especializado se codifica con su código local', () => {
    const orders = buildLabOrder({ ...base, items: toLabOrderItems([edadBiologica]) });
    expect(orders).toHaveLength(1);
    expect(orders[0].code?.coding?.[0]).toMatchObject({ code: 'edad-biologica-epigenetica' });
  });
});

describe('approveProposals', () => {
  const requester = { reference: 'Practitioner/dr1', display: 'Dra. X' };
  const proposals = buildLabOrder({
    subject: { reference: 'Patient/p1' },
    requester: { reference: 'Patient/p1' },
    items: toLabOrderItems([glucosa, insulina]),
    requisitionId: 'SOL-1',
    authoredOn: '2026-07-20T09:00:00Z',
    intent: 'proposal',
    notas: ['Solicitud del paciente desde el portal.'],
  });

  test('convierte proposal/draft en order/active sellado por el profesional', () => {
    const approved = approveProposals({ proposals, requester });
    for (const sr of approved) {
      expect(sr).toMatchObject({ intent: 'order', status: 'active', requester });
    }
  });

  test('conserva la requisición y el authoredOn original', () => {
    const approved = approveProposals({ proposals, requester });
    expect(approved[0].requisition).toEqual({ system: REQUISITION_SYSTEM, value: 'SOL-1' });
    expect(approved[0].authoredOn).toBe('2026-07-20T09:00:00Z');
  });

  test('agrega la nota de aprobación sin borrar la del paciente', () => {
    const approved = approveProposals({ proposals, requester, approvalNote: 'Aprobada por Dra. X.' });
    expect(approved[0].note).toEqual([
      { text: 'Solicitud del paciente desde el portal.' },
      { text: 'Aprobada por Dra. X.' },
    ]);
  });

  test('no toca los ServiceRequest que ya son orders', () => {
    const order = buildLabOrder({
      subject: { reference: 'Patient/p1' },
      items: toLabOrderItems([glucosa]),
      requisitionId: 'ORD-9',
      authoredOn: '2026-07-21T09:00:00Z',
    });
    const [unchanged] = approveProposals({ proposals: order, requester });
    expect(unchanged).toEqual(order[0]);
  });
});

// Guarda contra el catálogo REAL. Los identificadores del bundle mezclan
// convenciones (86 de 107 usan el código LOINC como identifier, 21 un slug),
// así que las fuentes de los derivados se declaran por código. Si alguien las
// cambia y dejan de resolver, el análisis desaparecería de la orden EN SILENCIO
// —el médico pide HOMA-IR y la glucosa no se pide—. Este test lo impide.
describe('Derivados contra el catálogo real', () => {
  const bundle = biomarkerBundle as unknown as { entry: { resource: ObservationDefinition }[] };
  const catalogo = toLabOrderItems(bundle.entry.map((e) => parseObservationDefinition(e.resource)));

  test('las fuentes declaradas existen en el catálogo', () => {
    for (const item of catalogo) {
      for (const source of item.derivedFrom ?? []) {
        const encontrada = catalogo.find((i) => i.code === source || i.biomarcadorId === source);
        expect(encontrada, `fuente "${source}" de "${item.biomarcadorId}" no está en el catálogo`).toBeDefined();
      }
    }
  });

  test('pedir HOMA-IR agrega glucosa e insulina a la orden', () => {
    const expandido = resolveDerivedSources(['homa-ir'], catalogo);
    const etiquetas = expandido
      .map((id) => catalogo.find((i) => i.biomarcadorId === id)?.label.toLowerCase())
      .filter(Boolean)
      .join(' | ');
    expect(etiquetas).toContain('glucosa');
    expect(etiquetas).toContain('insulina');
  });

  test('pedir eGFR agrega creatinina a la orden', () => {
    const expandido = resolveDerivedSources(['egfr-tfg-estimada'], catalogo);
    const etiquetas = expandido
      .map((id) => catalogo.find((i) => i.biomarcadorId === id)?.label.toLowerCase())
      .filter(Boolean)
      .join(' | ');
    expect(etiquetas).toContain('creatinina');
  });

  test('las fuentes agregadas son solicitables (si no, no llegarían al laboratorio)', () => {
    for (const id of resolveDerivedSources(['homa-ir', 'egfr-tfg-estimada'], catalogo)) {
      const item = catalogo.find((i) => i.biomarcadorId === id);
      if (item && item.orderability !== 'derived') {
        expect(item.orderable, `la fuente "${id}" no es solicitable`).toBe(true);
      }
    }
  });
});

describe('chunk (límite de escrituras por transacción)', () => {
  test('parte en tandas de a lo sumo MAX_WRITES_PER_TX', () => {
    const items = Array.from({ length: 51 }, (_, i) => i);
    const groups = chunk(items);
    expect(groups.every((g) => g.length <= MAX_WRITES_PER_TX)).toBe(true);
    expect(groups.flat()).toEqual(items); // no pierde ni reordena
    expect(MAX_WRITES_PER_TX).toBeLessThanOrEqual(50); // por debajo del tope del servidor
  });

  test('una tanda entera si entra en el tope', () => {
    expect(chunk([1, 2, 3], 40)).toEqual([[1, 2, 3]]);
  });

  test('lista vacía → sin tandas', () => {
    expect(chunk([])).toEqual([]);
  });
});

describe('groupByRequisition', () => {
  test('agrupa por número de orden', () => {
    const orders = buildLabOrder({
      subject: { reference: 'Patient/p1' },
      items: toLabOrderItems([glucosa, insulina]),
      requisitionId: 'ORD-7',
      authoredOn: '2026-07-23T10:00:00Z',
    });
    const groups = groupByRequisition(orders);
    expect(groups.size).toBe(1);
    expect(groups.get('ORD-7')).toHaveLength(2);
  });
});

describe('Preselección de preset por URL (?preset= de /laboratorio)', () => {
  const PANELES = [
    { panelCode: 'salud-celular', panelDisplay: 'Salud celular básica / metabolismo oxidativo' },
    { panelCode: 'lipidico-avanzado', panelDisplay: 'Perfil lipídico avanzado' },
  ];
  test('matchea por panelCode exacto', () => {
    expect(panelDelPreset('lipidico-avanzado', PANELES)).toBe(PANELES[1]);
  });

  test('matchea por nombre normalizado: sin diacríticos, guiones como espacios', () => {
    expect(panelDelPreset('salud-celular-basica', PANELES)).toBe(PANELES[0]);
    expect(panelDelPreset('LIPIDICO AVANZADO', PANELES)).toBe(PANELES[1]);
  });

  test("'completo' y 'todos' seleccionan el perfil entero", () => {
    expect(panelDelPreset('completo', PANELES)).toBe('completo');
    expect(panelDelPreset('perfil-completo', PANELES)).toBe('completo');
    expect(panelDelPreset('todos', PANELES)).toBe('completo');
  });

  // Un preset desconocido no selecciona nada: mejor un formulario vacío que
  // una orden armada con el panel equivocado.
  test('un preset desconocido devuelve undefined', () => {
    expect(panelDelPreset('panel-inexistente', PANELES)).toBeUndefined();
    expect(panelDelPreset('', PANELES)).toBeUndefined();
  });
});
