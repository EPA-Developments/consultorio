import type { Condition, MedicationRequest, Patient } from '@medplum/fhirtypes';
import { computeCKMSnapshot } from './compute';
import type { CKMObservationMap } from './observations';

function values(partial: Partial<CKMObservationMap>): CKMObservationMap {
  return partial as CKMObservationMap;
}

const paciente: Patient = { resourceType: 'Patient', id: 'p1', gender: 'female', birthDate: '1976-01-01' };
const sinMeds: MedicationRequest[] = [];

describe('computeCKMSnapshot (definición única compartida por el bot y la UI)', () => {
  test('calcula métricas y estadío a partir de los valores observados', () => {
    const snap = computeCKMSnapshot(
      values({
        sbp: { value: 152, unit: 'mmHg' },
        dbp: { value: 94, unit: 'mmHg' },
      }),
      paciente,
      [],
      sinMeds
    );
    expect(snap.metrics.find((m) => m.id === 'sbp')).toMatchObject({ value: 152 });
    // Hipertensión => factor de riesgo metabólico (estadío 2).
    expect(snap.stage).toBe(2);
  });

  test('una ECV clínica activa lleva al estadío 4', () => {
    const cvd: Condition = {
      resourceType: 'Condition',
      subject: { reference: 'Patient/p1' },
      clinicalStatus: { coding: [{ code: 'active' }] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I25.1' }] },
    };
    const snap = computeCKMSnapshot(values({ sbp: { value: 118, unit: 'mmHg' } }), paciente, [cvd], sinMeds);
    expect(snap.stage).toBe(4);
  });

  test('sin datos: métricas vacías y sin PREVENT (no inventa nada)', () => {
    const snap = computeCKMSnapshot(values({}), paciente, [], sinMeds);
    expect(snap.metrics).toHaveLength(0);
    expect(snap.prevent).toBeUndefined();
  });

  test('sin sexo declarado no se puede calcular PREVENT', () => {
    const snap = computeCKMSnapshot(
      values({ sbp: { value: 140, unit: 'mmHg' } }),
      { resourceType: 'Patient', id: 'p2', birthDate: '1976-01-01' },
      [],
      sinMeds
    );
    expect(snap.prevent).toBeUndefined();
  });

  test('con todos los insumos calcula los 3 scores PREVENT', () => {
    const snap = computeCKMSnapshot(
      values({
        sbp: { value: 140, unit: 'mmHg' },
        cholesterolTotal: { value: 200, unit: 'mg/dL' },
        hdlc: { value: 45, unit: 'mg/dL' },
        egfr: { value: 90, unit: 'mL/min/1.73m²' },
        bmi: { value: 28, unit: 'kg/m2' },
        hba1c: { value: 5.4, unit: '%' },
      }),
      paciente,
      [],
      sinMeds
    );
    expect(snap.prevent?.ascvd10y).toBeGreaterThan(0);
    expect(snap.prevent?.hf10y).toBeGreaterThan(0);
    expect(snap.prevent?.cvdTotal30y).toBeGreaterThan(0);
  });
});
