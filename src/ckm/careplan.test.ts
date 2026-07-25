import {
  AI_GENERATED_TAG,
  buildCarePlanMessages,
  CAREPLAN_DURATION_DAYS,
  proposalToCarePlan,
  proposalToGoals,
  proposalToTasks,
} from './careplan';
import type { CarePlanProposal } from './careplan';

const PROPOSAL: CarePlanProposal = {
  resumen: 'Plan para bajar la presión y el peso.',
  objetivos: [
    { descripcion: 'Reducir la presión', metrica: 'Presión sistólica', valorObjetivo: '< 130 mmHg', plazoDias: 90 },
    { descripcion: 'Caminar todos los días' },
  ],
  actividades: [
    { categoria: 'alimentacion', titulo: 'Menos sal', descripcion: 'Reducir sodio', frecuencia: 'diaria' },
    { categoria: 'actividad_fisica', titulo: 'Caminata', descripcion: 'Salir a caminar' },
  ],
  controles: [
    { titulo: 'Control de presión', descripcion: 'Tomar PA', diaProgramado: 30 },
    { titulo: 'Laboratorio', diaProgramado: 60 },
  ],
  planAlimentario: { descripcion: 'Dieta DASH', ejemplos: ['Ensalada criolla', 'Guiso de lentejas'] },
  planCaminata: { descripcion: 'Caminata progresiva', etapas: ['10 min', '20 min'] },
};

const START = '2026-06-17T00:00:00.000Z';

describe('careplan — prompt', () => {
  test('incluye estadío, edad y riesgo en el mensaje', () => {
    const { system, user } = buildCarePlanMessages({
      stage: 2,
      ageYears: 58,
      sex: 'male',
      prevent: { ascvd10y: 12.3, hf10y: 6.5, cvdTotal30y: 28 },
    });
    expect(system).toContain('100 días');
    expect(system).toContain('Argentina');
    expect(user).toContain('Estadío CKM: 2');
    expect(user).toContain('58 años');
    expect(user).toContain('ASCVD 10a 12.3%');
  });

  // Guardarraíl de privacidad (P0). El contexto que se manda a un proveedor
  // externo de IA debe ir SIEMPRE despersonalizado: sin nombre, documento,
  // fecha de nacimiento exacta, contacto, domicilio ni identificadores FHIR.
  // Si alguien agrega un campo identificatorio a CarePlanContext, este test
  // falla y obliga a revisar la decisión (base legal, Ley 25.326).
  test('el prompt NO contiene identificadores del paciente', () => {
    const { system, user } = buildCarePlanMessages({
      stage: 3,
      ageYears: 58,
      sex: 'female',
      metrics: [{ id: 'sbp', label: 'Presión sistólica', value: 148, unit: 'mmHg', status: 'concerning' } as never],
      conditions: ['Hipertensión arterial'],
      medications: ['enalapril'],
      sdohScore: 4,
    });
    const enviado = `${system}\n${user}`;

    // Solo se manda la EDAD derivada, nunca la fecha de nacimiento.
    expect(enviado).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // Ni referencias FHIR que permitan reidentificar al paciente.
    expect(enviado).not.toMatch(/Patient\/|Practitioner\//);
    // Ni documentos, contacto o correo.
    expect(enviado).not.toMatch(/DNI|CUIL|CUIT|@/i);
    // Y el prompt declara explícitamente que los datos van anonimizados.
    expect(user).toContain('anonimizados');
  });
});

describe('careplan — conversión a FHIR', () => {
  test('proposalToGoals genera Goals propuestos con target', () => {
    const goals = proposalToGoals(PROPOSAL, 'p1', START);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({
      resourceType: 'Goal',
      lifecycleStatus: 'proposed',
      subject: { reference: 'Patient/p1' },
    });
    expect(goals[0].target?.[0]).toMatchObject({ detailString: '< 130 mmHg' });
    expect(goals[0].target?.[0]?.dueDate).toBe('2026-09-15'); // +90 días
    expect(goals[1].target).toBeUndefined();
  });

  test('proposalToTasks programa controles con fecha futura', () => {
    const tasks = proposalToTasks(PROPOSAL, 'p1', START);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      resourceType: 'Task',
      status: 'requested',
      intent: 'plan',
      for: { reference: 'Patient/p1' },
    });
    expect(tasks[0].executionPeriod?.start).toBe('2026-07-17T00:00:00.000Z'); // +30 días
  });

  test('proposalToCarePlan crea borrador de 100 días con tag IA y actividades extra', () => {
    const goalRefs = [{ reference: 'Goal/g1' }, { reference: 'Goal/g2' }];
    const plan = proposalToCarePlan(PROPOSAL, 'p1', goalRefs, START);
    expect(plan).toMatchObject({
      resourceType: 'CarePlan',
      status: 'draft',
      intent: 'plan',
      subject: { reference: 'Patient/p1' },
    });
    expect(plan.meta?.tag?.[0]).toMatchObject({ code: AI_GENERATED_TAG.code });
    expect(plan.goal).toEqual(goalRefs);
    expect(plan.period?.end).toBe('2026-09-25T00:00:00.000Z'); // +100 días
    // 2 actividades + plan alimentario + plan de caminata
    expect(plan.activity).toHaveLength(PROPOSAL.actividades.length + 2);
    expect(plan.activity?.every((a) => a.detail?.status === 'not-started')).toBe(true);
    expect(plan.note?.[0]?.text).toContain('aprobado por el médico');
    expect(CAREPLAN_DURATION_DAYS).toBe(100);
  });
});
