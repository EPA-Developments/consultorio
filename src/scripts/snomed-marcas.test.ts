import { dciDeComposicion, parseFsnComercial } from './snomed-marcas';
import type { MedicamentoDelCatalogo } from './snomed-marcas';

// FSN real visto en la release 20260520 (grep del usuario sobre el RF2).
const COLMIBE =
  'COLMIBE [ATORVASTATIN (COMO ATORVASTATIN CALCICO) 40 MG + EZETIMIBA 10 MG] COMPRIMIDO (fármaco de uso clínico comercial)';

describe('Parseo del FSN comercial del DNM', () => {
  test('marca, composición y forma salen del patrón MARCA [COMPOSICION] FORMA', () => {
    expect(parseFsnComercial(COLMIBE)).toStrictEqual({
      marca: 'COLMIBE',
      composicion: 'ATORVASTATIN (COMO ATORVASTATIN CALCICO) 40 MG + EZETIMIBA 10 MG',
      forma: 'COMPRIMIDO',
    });
  });

  // Solo la clase comercial del DNM entra: las demás etiquetas no son marcas.
  test('otras etiquetas semánticas no parsean', () => {
    expect(
      parseFsnComercial('COLMIBE [ATORVASTATIN 40 MG] COMPRIMIDO por 30 UNIDADES (presentación farmacéutica comercial)')
    ).toBeUndefined();
    expect(parseFsnComercial('producto que contiene metformina (producto medicinal)')).toBeUndefined();
    expect(parseFsnComercial('metformina (sustancia)')).toBeUndefined();
  });

  // Combinación escrita como corchetes separados: el segundo corchete la delata.
  test('dos corchetes = combinación, no parsea', () => {
    expect(
      parseFsnComercial(
        'AMPLIAR DUO [ATORVASTATIN 10 MG] [EZETIMIBA 10 MG] COMPRIMIDO (fármaco de uso clínico comercial)'
      )
    ).toBeUndefined();
  });
});

describe('Composición → DCI del catálogo', () => {
  const MEDS: MedicamentoDelCatalogo[] = [
    { dci: 'rosuvastatina' },
    { dci: 'atorvastatina' },
    { dci: 'metformina' },
    { dci: 'ezetimibe', terminoSnomed: 'ezetimiba' },
  ];

  test('composición simple con sal y dosis', () => {
    expect(dciDeComposicion('ROSUVASTATINA (COMO ROSUVASTATINA CALCICA) 10 MG', MEDS)).toBe('rosuvastatina');
    expect(dciDeComposicion('METFORMINA 850 MG', MEDS)).toBe('metformina');
  });

  // La sal inline es nomenclatura ANMAT habitual y no cambia la DCI. El primer
  // reporte real lo probó: metformina quedaba con 2 marcas en vez de decenas.
  test('la sal pegada al nombre matchea por whitelist; otro fármaco pegado NO', () => {
    expect(dciDeComposicion('METFORMINA CLORHIDRATO 500 MG', MEDS)).toBe('metformina');
    expect(dciDeComposicion('ROSUVASTATINA CALCICA 20 MG', MEDS)).toBe('rosuvastatina');
    expect(dciDeComposicion('METFORMINA GLIBENCLAMIDA 500 MG', MEDS)).toBeUndefined();
  });

  // La variante ANMAT sin la vocal final, vista en el RF2 real.
  test('la grafía truncada de ANMAT matchea', () => {
    expect(dciDeComposicion('ATORVASTATIN (COMO ATORVASTATIN CALCICO) 20 MG', MEDS)).toBe('atorvastatina');
  });

  test('las dos grafías de ezetimiba entran por el alias del catálogo', () => {
    expect(dciDeComposicion('EZETIMIBA 10 MG', MEDS)).toBe('ezetimibe');
    expect(dciDeComposicion('EZETIMIBE 10 MG', MEDS)).toBe('ezetimibe');
  });

  // El peligro real: la combinación no mapea a una DCI única.
  test('las combinaciones quedan afuera', () => {
    expect(dciDeComposicion('ATORVASTATIN (COMO ATORVASTATIN CALCICO) 40 MG + EZETIMIBA 10 MG', MEDS)).toBeUndefined();
    expect(dciDeComposicion('ROSUVASTATINA 10 MG Y EZETIMIBE 10 MG', MEDS)).toBeUndefined();
  });

  // Regla definicional aprendida del primer reporte real (los "DUO" colados):
  // dos dosis = combinación, use el separador que use el DNM.
  test('dos dosis en la composición = combinación, sea cual sea el separador', () => {
    expect(dciDeComposicion('ATORVASTATINA 10 MG/EZETIMIBE 10 MG', MEDS)).toBeUndefined();
    expect(dciDeComposicion('EZETIMIBE 10 MG ROSUVASTATINA 20 MG', MEDS)).toBeUndefined();
    // Una sola dosis con decimales o miles sigue siendo mono.
    expect(dciDeComposicion('ROSUVASTATINA 2,5 MG', MEDS)).toBe('rosuvastatina');
  });

  test('un principio ajeno al catálogo no matchea', () => {
    expect(dciDeComposicion('GLIBENCLAMIDA 5 MG', MEDS)).toBeUndefined();
  });
});
