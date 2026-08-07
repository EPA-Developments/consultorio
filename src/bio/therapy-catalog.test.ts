import {
  contraindicacionesPorSeveridad,
  EVIDENCIA_LABELS,
  porEje,
  sesionesDeLaSerie,
  terapiaPorId,
  terapiasPorEje,
  todasLasTerapias,
  versionCatalogo,
} from './therapy-catalog';
import type { NivelEvidencia, Severidad } from './therapy-catalog';

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

describe('Series', () => {
  test('la serie se define en semanas y el total depende de la frecuencia', () => {
    const hbot = terapiaPorId('hbot')!;
    expect(hbot.serie.semanas).toBe(8);
    expect(sesionesDeLaSerie(hbot, 2)).toBe(16); // Standard
    expect(sesionesDeLaSerie(hbot, 3)).toBe(24); // Intensivo
  });

  test('todas las terapias declaran sus frecuencias posibles', () => {
    for (const t of todasLasTerapias()) {
      expect(t.serie.frecuenciasSemanales.length, t.nombre).toBeGreaterThan(0);
    }
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
