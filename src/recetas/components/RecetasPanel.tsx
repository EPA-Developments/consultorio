// Pestaña "Recetas" del chart: prescripción de medicamentos.
//
// Mismo patrón que el panel de órdenes de laboratorio: armar la receta, emitir
// por el único camino de escritura (receta-create, con el gate local + REFEPS
// compartido) e imprimir. El catálogo acota el tipeo; la receta libre (DCI a
// mano) siempre está disponible.
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import type { OptionsFilter } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { MedicationRequest, Patient, Practitioner } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ErrorCarga } from '../../components/ErrorCarga';
import type { EmissionStatus } from '../../laborders/lab-order-emission';
import { printHtmlDocument } from '../../laborders/lab-order-print';
import { estadoCatalogo, medicamentosDelCatalogo, presentacionesDe, snomedIdDe } from '../catalogo';
import { useVademecum } from '../hooks/useVademecum';
import { opcionesDeMarca } from '../marcas';
import { itemDesdeVademecum } from '../vademecum';
import { groupByReceta } from '../receta';
import type { ItemReceta } from '../receta';
import { createReceta } from '../receta-create';
import { emissionStatusOfReceta, getSelloReceta } from '../receta-emision';
import { buildRecetaPrintData, renderRecetaHtml } from '../receta-print';

interface ItemEnEdicion extends ItemReceta {
  /** Clave de React estable mientras se edita. */
  key: number;
}

const ITEM_NUEVO = (key: number): ItemEnEdicion => ({ key, dci: '', presentacion: '', cantidad: 1, posologia: '' });

export function RecetasPanel(props: { patient: Patient; cobertura?: string }): JSX.Element {
  const medplum = useMedplum();
  const [items, setItems] = useState<ItemEnEdicion[]>([ITEM_NUEVO(0)]);
  const [diagnostico, setDiagnostico] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [existentes, setExistentes] = useState<MedicationRequest[]>();
  const [errorLectura, setErrorLectura] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setExistentes(undefined);
    setErrorLectura(false);
    medplum
      .searchResources('MedicationRequest', {
        subject: `Patient/${props.patient.id}`,
        _sort: '-authoredon',
        _count: '200',
      })
      .then((reqs) => {
        if (!cancelled) {
          setExistentes(reqs);
        }
      })
      .catch((err) => {
        console.error('Recetas: error buscando recetas emitidas', err);
        if (!cancelled) {
          // "Sin recetas" con la lectura caída invita a repetir una receta que
          // ya existe. El error se muestra, no se disfraza de vacío.
          setErrorLectura(true);
          setExistentes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, props.patient.id, reloadKey]);

  const setItem = useCallback((key: number, cambio: Partial<ItemReceta>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...cambio } : i)));
  }, []);

  async function emitir(): Promise<void> {
    setEmitiendo(true);
    try {
      const { recetaId, requests, refeps } = await createReceta(medplum, {
        patient: props.patient,
        // Si la DCI matchea el catálogo, el conceptId SNOMED viaja solo: la
        // codificación es del catálogo, no una decisión del formulario.
        items: items.map(({ key: _key, ...item }) => ({ ...item, snomedId: item.snomedId ?? snomedIdDe(item.dci) })),
        diagnostico,
      });
      if (refeps.unavailable) {
        showNotification({
          color: 'yellow',
          title: 'Receta emitida SIN verificación REFEPS',
          message: `${recetaId}: el registro no respondió; la receta deja constancia de que salió sin verificar.`,
          autoClose: false,
        });
      } else {
        showNotification({
          icon: <IconCircleCheck />,
          color: 'teal',
          title: 'Receta emitida',
          message: `${recetaId} · ${requests.length} ${requests.length === 1 ? 'medicamento' : 'medicamentos'}. Matrícula verificada en REFEPS.`,
        });
      }
      setItems([ITEM_NUEVO(Date.now())]);
      setDiagnostico('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      showNotification({
        color: 'red',
        title: 'No se pudo emitir la receta',
        message: normalizeErrorString(err),
        autoClose: false,
      });
    } finally {
      setEmitiendo(false);
    }
  }

  async function imprimir(recetaId: string, requests: MedicationRequest[]): Promise<void> {
    let practitioner: Practitioner | undefined;
    const requesterRef = requests[0]?.requester?.reference;
    if (requesterRef?.startsWith('Practitioner/')) {
      try {
        practitioner = await medplum.readResource('Practitioner', requesterRef.split('/')[1]);
      } catch (err) {
        console.error('Recetas: no se pudo leer el prescriptor', err);
      }
    }
    if (!practitioner) {
      const profile = medplum.getProfile();
      if (profile?.resourceType === 'Practitioner') {
        practitioner = profile;
      }
    }
    // El documento declara SOLO el estado que puede probar: la firma se
    // confirma leyendo el Provenance; si esa lectura falla, se imprime como
    // borrador (conservador y veraz), nunca al revés.
    let hasSignature = false;
    const first = requests[0];
    if (first?.id && getSelloReceta(first)) {
      try {
        const provs = await medplum.searchResources('Provenance', {
          target: `MedicationRequest/${first.id}`,
          _count: '1',
        });
        hasSignature = provs.some((p) => (p.signature?.length ?? 0) > 0);
      } catch (err) {
        console.error('Recetas: no se pudo leer la firma (Provenance)', err);
      }
    }
    const emissionStatus: EmissionStatus = first ? emissionStatusOfReceta(first, hasSignature) : 'draft';
    const data = buildRecetaPrintData({
      emissionStatus,
      recetaId,
      requests,
      patient: props.patient,
      practitioner,
      logoUrl: '/logo.png',
      coverage: props.cobertura,
    });
    printHtmlDocument(renderRecetaHtml(data));
  }


  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Title order={4}>Recetas</Title>
        <Text c="dimmed" size="sm">
          Prescripción por nombre genérico (DCI, Ley 25.649). La emisión valida la matrícula localmente y contra REFEPS,
          igual que las órdenes de laboratorio.
        </Text>
      </Stack>

      {estadoCatalogo() === 'borrador' && (
        <Alert color="yellow" variant="light">
          <Text size="sm">
            La lista de medicamentos es un <strong>borrador</strong> pendiente de validación médica. Es solo una ayuda
            de tipeo: la DCI escrita a mano siempre vale.
          </Text>
        </Alert>
      )}

      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          {items.map((item, idx) => (
            <Card key={item.key} withBorder radius="sm" p="sm" bg="var(--mantine-color-gray-0)">
              <Group justify="space-between" mb={6}>
                <Text size="sm" fw={600}>
                  Medicamento {idx + 1}
                </Text>
                {items.length > 1 && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                  >
                    Quitar
                  </Button>
                )}
              </Group>
              <Group grow align="flex-start">
                <MedicamentoInput item={item} onCambio={(cambio) => setItem(item.key, cambio)} />
                <Autocomplete
                  label="Presentación"
                  placeholder="comprimidos 500 mg"
                  data={presentacionesDe(item.dci)}
                  value={item.presentacion ?? ''}
                  onChange={(v) => setItem(item.key, { presentacion: v })}
                />
                <NumberInput
                  label="Cantidad"
                  min={1}
                  step={1}
                  value={item.cantidad}
                  onChange={(v) => setItem(item.key, { cantidad: typeof v === 'number' ? v : 1 })}
                  required
                />
              </Group>
              <Group grow mt={6}>
                <TextInput
                  label="Posología"
                  placeholder="1 comprimido cada 12 h con las comidas, 30 días"
                  value={item.posologia}
                  onChange={(e) => setItem(item.key, { posologia: e.currentTarget.value })}
                  required
                />
                <TextInput
                  label="Marca sugerida (opcional, sustituible)"
                  value={item.marcaSugerida ?? ''}
                  onChange={(e) => setItem(item.key, { marcaSugerida: e.currentTarget.value || undefined })}
                />
              </Group>
            </Card>
          ))}

          <Group>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setItems((prev) => [...prev, ITEM_NUEVO(Date.now())])}
            >
              Agregar medicamento
            </Button>
          </Group>

          <Textarea
            label="Diagnóstico que motiva la prescripción"
            placeholder="Diabetes tipo 2 (E11.9)"
            value={diagnostico}
            onChange={(e) => setDiagnostico(e.currentTarget.value)}
            required
            autosize
            minRows={1}
          />

          <Group justify="flex-end">
            <Button onClick={emitir} loading={emitiendo}>
              Emitir receta
            </Button>
          </Group>
        </Stack>
      </Card>

      <RecetasEmitidas existentes={existentes} error={errorLectura} onPrint={imprimir} />
    </Stack>
  );
}

// ── Buscador de medicamento: catálogo local + vademécum del servidor ────────

// El buscador entiende genéricos, marcas del catálogo y el vademécum DNM
// completo servido por $expand: elegir una marca fija la DCI como medicamento
// (lo que se prescribe, Ley 25.649) y deja la marca como sugerencia
// sustituible. La marca busca, la DCI prescribe. Si el servidor no responde,
// el catálogo local y el texto libre siguen enteros (lección REFEPS).

const MARCAS_LOCALES = new Map(opcionesDeMarca().map((o) => [o.etiqueta, o]));
const GENERICOS_LOCALES = medicamentosDelCatalogo().map((m) => m.dci);

function normalizarBusqueda(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

// Los resultados del servidor ya vienen filtrados por $expand; el filtro de
// Mantine solo recorta los grupos locales (si no, escondería resultados que
// el servidor sí matcheó, por acentos o espacios).
const filtroMedicamento: OptionsFilter = ({ options, search }) => {
  const q = normalizarBusqueda(search.trim());
  return options
    .map((grupo) => {
      if (!('group' in grupo)) {
        return grupo;
      }
      if (grupo.group.includes('servidor')) {
        return grupo;
      }
      return { ...grupo, items: grupo.items.filter((i) => normalizarBusqueda(String(i.value)).includes(q)) };
    })
    .filter((grupo) => !('group' in grupo) || grupo.items.length > 0);
};

function MedicamentoInput(props: { item: ItemReceta; onCambio: (cambio: Partial<ItemReceta>) => void }): JSX.Element {
  const vademecum = useVademecum(props.item.dci);
  const delServidor = new Map(vademecum.opciones.map((o) => [o.display, o]));

  const data = [
    { group: 'Genéricos (DCI)', items: GENERICOS_LOCALES },
    { group: 'Marca comercial → genérico', items: [...MARCAS_LOCALES.keys()] },
    ...(delServidor.size > 0
      ? [{ group: 'Vademécum ANMAT (servidor)', items: [...delServidor.keys()].filter((d) => !MARCAS_LOCALES.has(d)) }]
      : []),
  ];

  return (
    <Autocomplete
      label="Medicamento (DCI o marca)"
      placeholder="semaglutida… o Crestor"
      data={data}
      filter={filtroMedicamento}
      limit={24}
      value={props.item.dci}
      rightSection={vademecum.buscando ? <Loader size="xs" /> : undefined}
      description={
        vademecum.caido
          ? 'El vademécum del servidor no respondió: seguís con el catálogo local y el texto libre.'
          : undefined
      }
      onChange={(v) => {
        const marcaLocal = MARCAS_LOCALES.get(v);
        const servidor = delServidor.get(v);
        if (marcaLocal) {
          props.onCambio({ dci: marcaLocal.dci, marcaSugerida: marcaLocal.marca });
        } else if (servidor) {
          props.onCambio(itemDesdeVademecum(servidor));
        } else {
          props.onCambio({ dci: v });
        }
      }}
      required
    />
  );
}

function RecetasEmitidas(props: {
  existentes?: MedicationRequest[];
  error: boolean;
  onPrint: (recetaId: string, requests: MedicationRequest[]) => void | Promise<void>;
}): JSX.Element {
  if (props.existentes === undefined) {
    return <Loader size="sm" />;
  }
  if (props.error) {
    return <ErrorCarga que="las recetas emitidas de este paciente" />;
  }
  if (props.existentes.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        Sin recetas emitidas para este paciente.
      </Text>
    );
  }
  const grupos = [...groupByReceta(props.existentes).entries()];
  return (
    <Stack gap="xs">
      <Title order={5}>Recetas emitidas</Title>
      {grupos.map(([recetaId, reqs]) => (
        <Card key={recetaId} withBorder radius="md" p="sm">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={600} size="sm">
                {recetaId} · {fmtFecha(reqs[0]?.authoredOn)}
              </Text>
              <Text size="sm" c="dimmed">
                {reqs
                  .map((r) => r.medicationCodeableConcept?.text)
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {reqs[0]?.reasonCode?.[0]?.text && (
                <Text size="xs" c="dimmed">
                  Dx: {reqs[0].reasonCode[0].text}
                </Text>
              )}
            </div>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPrinter size={14} />}
              onClick={() => props.onPrint(recetaId, reqs)}
            >
              Imprimir
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}

function fmtFecha(iso?: string): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR');
}
