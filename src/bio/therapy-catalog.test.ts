import {
  contraindicacionesPorSeveridad,
  duracionTexto,
  esquemaPara,
  EVIDENCIA_LABELS,
  limitesAlcanzados,
  objetivosDisponibles,
  porEje,
  sesionesDelEsquema,
  terapiaPorId,
  terapiasPorEje,
  todasLasTerapias,
  versionCatalogo,
} from './therapy-catalog';
import type { NivelEvidencia, Objetivo, Severidad } from './therapy-catalog';
import { terapiasPorObjetivo } from './therapy-catalog';

describe('Catálogo', () => {
  test('tiene las seis terapias del catálogo publicado', () => {
    expect(todasLasTerapias().map((t) => t.id).sort()).toStrictEqual([
      'botas',
      'hbot',
      'ihht',
      'iv-therapy',
      'recovery-pro',
      'red-light',
    ]);
    expect(versionCatalogo()).toBeTruthy();
  });

  test('cada terapia declara al menos un eje válido', () => {
    for (const t of todasLasTerapias()) {
      expect(t.ejes.length, t.nombre).toBeGreaterThan(0);
      for (const e of t.ejes) {
        expect(['rejuvenecer', 'recuperar', 'reparar'], `${t.nombre}: ${e}`).toContain(e);
      }
    }
  });

  test('los tres ejes tienen terapias', () => {
    for (const grupo of porEje()) {
      expect(grupo.terapias.length, grupo.eje).toBeGreaterThan(0);
    }
  });

  test('una terapia puede estar en varios ejes', () => {
    const hbot = terapiaPorId('hbot')!;
    expect(hbot.ejes).toStrictEqual(['rejuvenecer', 'reparar']);
    expect(terapiasPorEje('rejuvenecer').map((t) => t.id)).toContain('hbot');
    expect(terapiasPorEje('reparar').map((t) => t.id)).toContain('hbot');
  });
});

describe('Estado de validación', () => {
  // El material publicado tiene hoy class="validado" en el body Y el cartel
  // "pendiente de validación". Este test impide que ese desfasaje se repita acá.
  test('ninguna terapia se declara validada sin quién y cuándo', () => {
    for (const t of todasLasTerapias()) {
      if (t.validacion.estado === 'validado') {
        expect(t.validacion.validadoPor, `${t.nombre}: validada sin firmante`).toBeTruthy();
        expect(t.validacion.validadoEl, `${t.nombre}: validada sin fecha`).toBeTruthy();
      }
    }
  });

  test('hoy todas están en borrador: nadie las validó todavía', () => {
    for (const t of todasLasTerapias()) {
      expect(t.validacion.estado, t.nombre).toBe('borrador');
    }
  });
});

describe('Parámetros', () => {
  // El problema difícil del modelo: una sesión de HBOT y una de Red Light no
  // comparten ningún campo. Por eso cada terapia declara los suyos.
  test('cada terapia declara sus propios parámetros, con unidad', () => {
    for (const t of todasLasTerapias()) {
      expect(t.parametros.length, t.nombre).toBeGreaterThan(0);
      for (const p of t.parametros) {
        expect(p.clave, `${t.nombre}: parámetro sin clave`).toBeTruthy();
        expect(p.etiqueta, `${t.nombre}/${p.clave}`).toBeTruthy();
        if (p.tipo === 'numero' && p.clave !== 'ciclos' && p.clave !== 'camaras' && p.clave !== 'air_breaks') {
          expect(p.unidad, `${t.nombre}/${p.clave}: número sin unidad`).toBeTruthy();
        }
      }
    }
  });

  test('los parámetros de HBOT y Red Light no se parecen en nada', () => {
    const hbot = terapiaPorId('hbot')!.parametros.map((p) => p.clave);
    const luz = terapiaPorId('red-light')!.parametros.map((p) => p.clave);
    const comunes = hbot.filter((c) => luz.includes(c));
    expect(comunes).toStrictEqual(['duracion_min']); // solo el tiempo
  });

  // Lo que se vende no es lo que actúa: en HBOT el mecanismo son las pausas.
  test('HBOT registra las pausas de aire, no solo la presión', () => {
    const hbot = terapiaPorId('hbot')!;
    const pausas = hbot.parametros.find((p) => p.clave === 'air_breaks')!;
    expect(pausas.nota).toMatch(/fluctuación/i);
  });

  // En IHHT la dosis es la SpO2 alcanzada, no el ajuste del equipo.
  test('IHHT registra la SpO₂ objetivo y la de corte', () => {
    const claves = terapiaPorId('ihht')!.parametros.map((p) => p.clave);
    expect(claves).toContain('spo2_objetivo');
    expect(claves).toContain('spo2_corte');
  });

  test('la temperatura del agua tiene piso y techo declarados', () => {
    const agua = terapiaPorId('recovery-pro')!.parametros.find((p) => p.clave === 'agua_temp')!;
    expect(agua.min).toBe(10);
    expect(agua.max).toBe(15);
    expect(agua.nota).toMatch(/adultos mayores/i);
  });
});

describe('Contraindicaciones', () => {
  test('todas tienen texto, severidad y nivel de evidencia', () => {
    const severidades: Severidad[] = ['bloquea', 'evaluacion', 'condicional', 'difiere'];
    const niveles: NivelEvidencia[] = Object.keys(EVIDENCIA_LABELS) as NivelEvidencia[];
    for (const t of todasLasTerapias()) {
      expect(t.contraindicaciones.length, t.nombre).toBeGreaterThan(0);
      for (const c of t.contraindicaciones) {
        expect(c.texto, `${t.nombre}/${c.id}`).toBeTruthy();
        expect(severidades, `${t.nombre}/${c.id}`).toContain(c.severidad);
        expect(niveles, `${t.nombre}/${c.id}: evidencia inválida`).toContain(c.evidencia);
      }
    }
  });

  test('los patrones ICD-10 compilan', () => {
    for (const t of todasLasTerapias()) {
      for (const c of t.contraindicaciones) {
        if (c.icd10) {
          expect(() => new RegExp(c.icd10 as string), `${t.nombre}/${c.id}`).not.toThrow();
        }
      }
    }
  });

  test('HBOT tiene el neumotórax como único bloqueo absoluto', () => {
    const bloqueos = contraindicacionesPorSeveridad(terapiaPorId('hbot')!, 'bloquea');
    expect(bloqueos.map((c) => c.id)).toStrictEqual(['neumotorax']);
  });

  // El consenso cambió: antes era absoluta, hoy no lo es sin compromiso pulmonar.
  test('bleomicina quedó como evaluación, no como bloqueo', () => {
    const quimio = terapiaPorId('hbot')!.contraindicaciones.find((c) => c.id === 'quimio-reciente')!;
    expect(quimio.severidad).toBe('evaluacion');
    expect(quimio.fuente).toMatch(/consenso actual/i);
  });

  // Faltaban en el material publicado; el catálogo las agrega.
  test('Recovery Pro incorpora Raynaud, urticaria a frigore y alcohol', () => {
    const ids = terapiaPorId('recovery-pro')!.contraindicaciones.map((c) => c.id);
    for (const id of ['raynaud', 'urticaria-frigore', 'alcohol']) {
      expect(ids, id).toContain(id);
    }
  });

  test('IHHT incorpora anemia severa, cáncer activo y apnea', () => {
    const ids = terapiaPorId('ihht')!.contraindicaciones.map((c) => c.id);
    for (const id of ['anemia-severa', 'cancer-activo', 'apnea']) {
      expect(ids, id).toContain(id);
    }
  });

  // La fiebre aparecía junto a las contraindicaciones reales. No es lo mismo.
  test('la fiebre difiere la sesión: no bloquea la terapia', () => {
    for (const id of ['hbot', 'ihht', 'recovery-pro']) {
      const fiebre = terapiaPorId(id)!.contraindicaciones.find((c) => c.id === 'fiebre');
      expect(fiebre?.severidad, id).toBe('difiere');
    }
  });

  // Con evidencia mecanística y consecuencia grave, igual se bloquea.
  test('la hipertensión pulmonar bloquea IHHT aunque la evidencia sea mecanística', () => {
    const hp = terapiaPorId('ihht')!.contraindicaciones.find((c) => c.id === 'hipertension-pulmonar')!;
    expect(hp.severidad).toBe('bloquea');
    expect(hp.evidencia).toBe('mecanistico-sin-ensayos');
  });

  test('el embarazo es condicional en IHHT y bloqueo en Recovery Pro', () => {
    expect(terapiaPorId('ihht')!.contraindicaciones.find((c) => c.id === 'embarazo')?.severidad).toBe('condicional');
    expect(terapiaPorId('recovery-pro')!.contraindicaciones.find((c) => c.id === 'embarazo')?.severidad).toBe('bloquea');
  });
});

describe('Esquemas: la serie depende del objetivo, no de la terapia', () => {
  // La corrección que trajo el caso del maratonista: no existe "la serie" de
  // HBOT. Existe la serie para preparar una competencia y la serie para un
  // programa de longevidad, y son distintas.
  test('cada terapia declara al menos un esquema, con objetivo y frecuencia', () => {
    for (const t of todasLasTerapias()) {
      expect(t.esquemas.length, t.nombre).toBeGreaterThan(0);
      for (const e of t.esquemas) {
        expect(e.frecuenciaSemanal.length, `${t.nombre}/${e.objetivo}`).toBeGreaterThan(0);
        expect(e.duracion.tipo, `${t.nombre}/${e.objetivo}`).toBeTruthy();
      }
    }
  });

  test('HBOT admite frecuencia diaria para preparar un evento y baja para longevidad', () => {
    const hbot = terapiaPorId('hbot')!;
    const evento = esquemaPara(hbot, 'preparacion-deportiva')!;
    const longevidad = esquemaPara(hbot, 'longevidad')!;
    expect(Math.max(...evento.frecuenciaSemanal)).toBe(7);
    expect(Math.min(...longevidad.frecuenciaSemanal)).toBe(2);
  });

  test('una preparación para evento no tiene semanas: dura hasta el evento', () => {
    const evento = esquemaPara(terapiaPorId('hbot')!, 'preparacion-deportiva')!;
    expect(evento.duracion.tipo).toBe('hasta-evento');
    expect(duracionTexto(evento.duracion)).toBe('hasta el evento');
  });

  // Informar un total en un esquema sin fin sería inventarlo.
  test('sesionesDelEsquema no devuelve un total cuando la duración no es en semanas', () => {
    const hbot = terapiaPorId('hbot')!;
    expect(sesionesDelEsquema(esquemaPara(hbot, 'preparacion-deportiva')!, 7)).toBeUndefined();
    expect(sesionesDelEsquema(esquemaPara(hbot, 'recuperacion-deportiva')!, 3)).toBeUndefined();
    expect(sesionesDelEsquema(esquemaPara(hbot, 'longevidad')!, 2)).toBe(16);
    expect(sesionesDelEsquema(esquemaPara(hbot, 'longevidad')!, 5)).toBe(40);
  });

  test('el catálogo cubre los objetivos que la práctica ofrece', () => {
    const objetivos = objetivosDisponibles();
    for (const o of ['longevidad', 'preparacion-deportiva', 'recuperacion-deportiva'] as Objetivo[]) {
      expect(objetivos, o).toContain(o);
    }
  });

  test('se puede buscar qué terapias sirven a un objetivo', () => {
    const ids = terapiasPorObjetivo('preparacion-deportiva').map((t) => t.id);
    expect(ids).toContain('hbot');
    expect(ids).toContain('ihht');
    expect(ids).not.toContain('iv-therapy');
  });

  test('una terapia no tiene esquema para un objetivo que no cubre', () => {
    expect(esquemaPara(terapiaPorId('botas')!, 'longevidad')).toBeUndefined();
  });
});

describe('Topes de exposición acumulada', () => {
  // El riesgo que el esquema diario hace posible: 8 semanas a 7 por semana son
  // 56 sesiones, y dos bloques pasan las 100.
  const hbot = () => terapiaPorId('hbot')!;

  test('HBOT declara el tope de 100 sesiones por el riesgo refractivo irreversible', () => {
    const tope = hbot().limitesAcumulados!.find((l) => l.sesionesAcumuladas === 100)!;
    expect(tope.texto).toMatch(/irreversible/i);
    expect(tope.severidad).toBe('evaluacion');
  });

  test('no se alcanza ningún límite al empezar', () => {
    expect(limitesAlcanzados(hbot(), 0)).toStrictEqual([]);
  });

  test('a las 20 sesiones aparece el control visual, a las 100 el tope', () => {
    expect(limitesAlcanzados(hbot(), 20).map((l) => l.sesionesAcumuladas)).toStrictEqual([20]);
    expect(limitesAlcanzados(hbot(), 100).map((l) => l.sesionesAcumuladas)).toStrictEqual([100, 20]);
  });

  test('dos bloques diarios de 8 semanas cruzan el tope', () => {
    const bloque = 8 * 7;
    expect(limitesAlcanzados(hbot(), bloque)).toHaveLength(1);
    expect(limitesAlcanzados(hbot(), bloque * 2).some((l) => l.sesionesAcumuladas === 100)).toBe(true);
  });

  test('las terapias sin tope declarado devuelven lista vacía', () => {
    expect(limitesAlcanzados(terapiaPorId('botas')!, 500)).toStrictEqual([]);
  });
});

describe('Medicalización', () => {
  // Es el eje que gobierna cuánto gatea el panel, y sale del propio material:
  // IV Therapy es la única etiquetada "con indicación médica"; Recovery Pro se
  // describe como "bienestar más que tratamiento".
  test('IV Therapy es el único acto médico completo', () => {
    const actos = todasLasTerapias().filter((t) => t.medicalizacion === 'acto-medico');
    expect(actos.map((t) => t.id)).toStrictEqual(['iv-therapy']);
  });

  test('Recovery Pro está clasificada como bienestar', () => {
    expect(terapiaPorId('recovery-pro')!.medicalizacion).toBe('bienestar');
  });

  test('HBOT e IHHT exigen evaluación médica', () => {
    expect(terapiaPorId('hbot')!.medicalizacion).toBe('evaluacion-medica');
    expect(terapiaPorId('ihht')!.medicalizacion).toBe('evaluacion-medica');
  });
});

describe('Tamizaje previo', () => {
  test('IHHT exige el test de tolerancia a la hipoxia', () => {
    const t = terapiaPorId('ihht')!.tamizajePrevio.find((x) => /tolerancia a la hipoxia/i.test(x.texto));
    expect(t?.obligatorio).toBe(true);
  });

  test('IV Therapy exige G6PD antes de vitamina C en dosis alta', () => {
    const g6pd = terapiaPorId('iv-therapy')!.tamizajePrevio.find((x) => /G6PD/i.test(x.texto));
    expect(g6pd?.obligatorio).toBe(true);
  });

  test('HBOT exige evaluación ótica y visual basal', () => {
    const textos = terapiaPorId('hbot')!.tamizajePrevio.map((x) => x.texto).join(' ');
    expect(textos).toMatch(/timpánica/i);
    expect(textos).toMatch(/refracción|visual/i);
  });
});
