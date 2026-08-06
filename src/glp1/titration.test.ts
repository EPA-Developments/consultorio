import type { GLP1Inputs } from './eligibility';
import {
  concomitantAdjustments,
  indicationFor,
  moleculesFor,
  safetyWatch,
  titrationFor,
  weeksToMaxDose,
  weeksToTherapeuticDose,
} from './titration';

function paciente(extra: Partial<GLP1Inputs> = {}): GLP1Inputs {
  return { ageYears: 52, sex: 'male', bmi: 33, waistCm: 105, hba1cPercent: 5.6, egfr: 90, ...extra };
}

describe('Esquemas de titulación', () => {
  test('cada esquema arranca en el escalón 1 y numera sin saltos', () => {
    for (const ind of ['dm2', 'obesidad'] as const) {
      for (const mol of moleculesFor(ind)) {
        const e = titrationFor(mol, ind)!;
        expect(e.steps.map((s) => s.step), `${mol}/${ind}`).toStrictEqual(
          e.steps.map((_, k) => k + 1)
        );
      }
    }
  });

  test('la dosis máxima declarada coincide con la del último escalón', () => {
    for (const ind of ['dm2', 'obesidad'] as const) {
      for (const mol of moleculesFor(ind)) {
        const e = titrationFor(mol, ind)!;
        const ultima = e.steps[e.steps.length - 1].dose;
        expect(e.maxDose, `${mol}/${ind}`).toContain(ultima);
      }
    }
  });

  test('todo escalón dura al menos una semana', () => {
    for (const ind of ['dm2', 'obesidad'] as const) {
      for (const mol of moleculesFor(ind)) {
        for (const s of titrationFor(mol, ind)!.steps) {
          expect(s.weeks, `${mol}/${ind} escalón ${s.step}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test('ningún esquema nombra una marca comercial', () => {
    const texto = JSON.stringify(
      (['dm2', 'obesidad'] as const).flatMap((ind) => moleculesFor(ind).map((m) => titrationFor(m, ind)))
    );
    for (const marca of ['Ozempic', 'Wegovy', 'Rybelsus', 'Mounjaro', 'Zepbound', 'Saxenda', 'Victoza', 'Trulicity']) {
      expect(texto).not.toContain(marca);
    }
  });

  test('semaglutida para obesidad llega a 2,4 mg; para DM2 se queda en 2 mg', () => {
    expect(titrationFor('Semaglutida', 'obesidad')!.maxDose).toContain('2,4 mg');
    expect(titrationFor('Semaglutida', 'dm2')!.maxDose).toContain('2 mg');
  });

  test('dulaglutida no tiene esquema de control de peso', () => {
    expect(titrationFor('Dulaglutida', 'dm2')).toBeDefined();
    expect(titrationFor('Dulaglutida', 'obesidad')).toBeUndefined();
  });

  test('la presentación oral avisa del ayuno y los 30 minutos', () => {
    const notas = titrationFor('Semaglutida oral', 'dm2')!.notes.join(' ');
    expect(notas).toMatch(/ayunas/i);
    expect(notas).toMatch(/30 minutos/);
  });
});

describe('Dosis de inicio vs dosis terapéutica', () => {
  // La confusión entre las dos es la causa típica de "no me funcionó": se
  // juzga el resultado en una dosis que solo servía para tolerar el fármaco.
  test('el primer escalón de semaglutida y tirzepatida no es terapéutico', () => {
    expect(titrationFor('Semaglutida', 'obesidad')!.steps[0].therapeutic).toBe(false);
    expect(titrationFor('Tirzepatida', 'obesidad')!.steps[0].therapeutic).toBe(false);
  });

  test('dulaglutida ya arranca en dosis terapéutica', () => {
    expect(titrationFor('Dulaglutida', 'dm2')!.steps[0].therapeutic).toBe(true);
    expect(weeksToTherapeuticDose(titrationFor('Dulaglutida', 'dm2')!)).toBe(0);
  });

  test('semaglutida para obesidad tarda 8 semanas en llegar a dosis terapéutica', () => {
    // 0,25 mg (4 sem) + 0,5 mg (4 sem) -> 1 mg en la semana 8.
    expect(weeksToTherapeuticDose(titrationFor('Semaglutida', 'obesidad')!)).toBe(8);
  });

  test('tirzepatida llega a la dosis máxima en 20 semanas si se escala sin pausas', () => {
    expect(weeksToMaxDose(titrationFor('Tirzepatida', 'obesidad')!)).toBe(20);
  });
});

describe('Indicación según el perfil', () => {
  test('con diabetes diagnosticada usa el esquema de DM2', () => {
    expect(indicationFor(paciente({ hasT2D: true }))).toBe('dm2');
  });

  test('con HbA1c ≥ 6.5 usa el esquema de DM2 aunque no haya diagnóstico', () => {
    expect(indicationFor(paciente({ hba1cPercent: 7.2 }))).toBe('dm2');
  });

  test('sin diabetes usa el esquema de control de peso', () => {
    expect(indicationFor(paciente())).toBe('obesidad');
  });
});

describe('Ajuste de la medicación concomitante', () => {
  test('con insulina indica reducir la basal', () => {
    const a = concomitantAdjustments(paciente({ onInsulin: true }));
    expect(a.some((x) => /insulina/i.test(x.text) && /reducir/i.test(x.text))).toBe(true);
  });

  test('con sulfonilurea indica reducir a la mitad o suspender', () => {
    const a = concomitantAdjustments(paciente({ onSulfonylurea: true }));
    expect(a.some((x) => /sulfonilurea/i.test(x.text))).toBe(true);
  });

  test('sin insulina ni sulfonilurea no inventa ajustes', () => {
    expect(concomitantAdjustments(paciente())).toHaveLength(0);
  });

  test('si ya recibe un GLP-1 avisa que no se suman dos', () => {
    const a = concomitantAdjustments(paciente({ onGLP1: true }));
    expect(a.some((x) => /no se suman dos/i.test(x.text))).toBe(true);
  });
});

describe('Vigilancia durante el tratamiento', () => {
  test('siempre advierte sobre pancreatitis y tolerancia digestiva', () => {
    const s = safetyWatch(paciente(), 'obesidad');
    expect(s.some((x) => /pancreatitis/i.test(x.text))).toBe(true);
    expect(s.some((x) => /náuseas/i.test(x.text))).toBe(true);
  });

  test('en control de peso advierte sobre vesícula aunque no haya antecedente', () => {
    expect(safetyWatch(paciente(), 'obesidad').some((x) => /vesícula/i.test(x.text))).toBe(true);
  });

  test('con insulina agrega automonitoreo de hipoglucemia', () => {
    const s = safetyWatch(paciente({ onInsulin: true }), 'dm2');
    expect(s.some((x) => /hipoglucemia/i.test(x.text))).toBe(true);
  });

  test('≥60 años: masa magra con objetivo proteico y fuerza', () => {
    const s = safetyWatch(paciente({ ageYears: 68 }), 'obesidad');
    expect(s.some((x) => /masa magra/i.test(x.text) && /fuerza/i.test(x.text))).toBe(true);
  });

  // Vida media larga: no alcanza con suspender al confirmar el embarazo.
  test('mujer en edad fértil: planificar la suspensión 2 meses antes', () => {
    const s = safetyWatch(paciente({ sex: 'female', ageYears: 34 }), 'obesidad');
    expect(s.some((x) => /embarazo/i.test(x.text) && /2 meses/.test(x.text))).toBe(true);
  });

  test('mujer de 62: no aparece la advertencia de embarazo', () => {
    const s = safetyWatch(paciente({ sex: 'female', ageYears: 62 }), 'obesidad');
    expect(s.some((x) => /embarazo/i.test(x.text))).toBe(false);
  });

  test('eGFR <30: advierte deshidratación e injuria renal aguda', () => {
    const s = safetyWatch(paciente({ egfr: 25 }), 'obesidad');
    expect(s.some((x) => /deshidrat/i.test(x.text))).toBe(true);
  });
});
