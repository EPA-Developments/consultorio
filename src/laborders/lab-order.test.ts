import type { BiomarkerDefinition } from '../ckm/observation-definitions';
import { LOINC_SYSTEM } from '../ckm/observation-definitions';
import {
  approveProposals,
  buildLabOrder,
  groupByRequisition,
  LABORATORY_CATEGORY,
  orderabilityFor,
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
const insulina = def({ biomarcadorId: 'insulina-en-ayunas', label: 'Insulina', code: '27353-2', system: LOINC_SYSTEM });
const homaIr = def({ biomarcadorId: 'homa-ir', label: 'HOMA-IR', code: 'homa-ir', system: LOCAL_SYSTEM });
const creatinina = def({ biomarcadorId: 'creatinina', label: 'Creatinina', code: '2160-0', system: LOINC_SYSTEM });
const egfr = def({ biomarcadorId: 'egfr-tfg-estimada', label: 'eGFR', code: '98979-8', system: LOINC_SYSTEM });
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

  test('LOINC ausente pero código local presente igual es especializado', () => {
    expect(orderabilityFor(def({ biomarcadorId: 'zonulina', code: 'zonulina', system: LOCAL_SYSTEM }))).toBe(
      'specialized'
    );
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

  test('expone las fuentes de los derivados', () => {
    const byId = new Map(items.map((i) => [i.biomarcadorId, i]));
    expect(byId.get('egfr-tfg-estimada')?.derivedFrom).toEqual(['creatinina']);
    expect(byId.get('homa-ir')?.derivedFrom).toEqual(['glucosa-en-ayunas', 'insulina-en-ayunas']);
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
    const orders = buildLabOrder({ ...base, note: 'OSDE 210 · ayuno 12 h' });
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
    note: 'Solicitud del paciente desde el portal.',
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
