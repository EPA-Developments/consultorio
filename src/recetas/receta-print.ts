// Impresión / PDF de una receta de medicamentos.
//
// Misma mecánica que lab-order-print: documento HTML autocontenido, parte pura
// testeable, impresión vía printHtmlDocument (compartida). La diferencia es la
// forma del cuerpo: una receta no es una tabla de estudios sino bloques Rp/
// con DCI, presentación, cantidad y posología.
//
// El pie legal reutiliza EMISSION_STATUS: el documento NUNCA declara una
// validez que no tiene. La firma digital del profesional (firmar.gob.ar) se
// aplica sobre el PDF generado; este documento deja el espacio y la identidad.
import { formatHumanName, getDisplayString } from '@medplum/core';
import type { MedicationRequest, Patient, Practitioner } from '@medplum/fhirtypes';
import { DNI_SYSTEM, getIdentifierValue } from '../ckm/argentina';
import { EMISSION_STATUS } from '../laborders/lab-order-emission';
import type { EmissionStatus } from '../laborders/lab-order-emission';
import { specialtyOf } from '../laborders/lab-order-print';
import { matriculaOf } from '../laborders/practitioner-validation';

export interface RecetaPrintItem {
  /** DCI + presentación, como quedó en el MedicationRequest. */
  medicamento: string;
  cantidad?: number;
  posologia?: string;
  /** Nota del ítem (ej. marca sugerida). */
  nota?: string;
}

export interface RecetaPrintData {
  clinicName: string;
  clinicSubtitle?: string;
  logoUrl?: string;
  patientName: string;
  patientDni?: string;
  patientBirthDate?: string;
  coverage?: string;
  practitionerName?: string;
  practitionerMatricula?: string;
  practitionerSpecialty?: string;
  diagnostico?: string;
  recetaId: string;
  authoredOn: string;
  items: RecetaPrintItem[];
  emissionStatus?: EmissionStatus;
  registryLegend?: string;
}

const CLINIC_NAME = 'BioWellness';
const CLINIC_SUBTITLE = 'Medicina Funcional y Longevidad · San Isidro, PBA';

/** Arma los datos de impresión desde los MedicationRequest de una receta. */
export function buildRecetaPrintData(params: {
  recetaId: string;
  requests: MedicationRequest[];
  patient: Patient;
  practitioner?: Practitioner;
  logoUrl?: string;
  emissionStatus?: EmissionStatus;
  registryLegend?: string;
}): RecetaPrintData {
  const { requests, patient, practitioner } = params;
  const first = requests[0];
  return {
    clinicName: CLINIC_NAME,
    clinicSubtitle: CLINIC_SUBTITLE,
    logoUrl: params.logoUrl,
    patientName: patient.name?.[0] ? formatHumanName(patient.name[0]) : getDisplayString(patient),
    patientDni: getIdentifierValue(patient, DNI_SYSTEM),
    patientBirthDate: patient.birthDate,
    practitionerName: practitioner?.name?.[0]
      ? formatHumanName(practitioner.name[0])
      : practitioner
        ? getDisplayString(practitioner)
        : undefined,
    practitionerMatricula: matriculaOf(practitioner),
    practitionerSpecialty: specialtyOf(practitioner),
    diagnostico: first?.reasonCode?.[0]?.text,
    recetaId: params.recetaId,
    authoredOn: first?.authoredOn ?? '',
    items: requests.map((r) => ({
      medicamento: r.medicationCodeableConcept?.text ?? '(sin medicamento)',
      cantidad: r.dispenseRequest?.quantity?.value,
      posologia: r.dosageInstruction?.[0]?.text,
      nota: r.note?.find((n) => n.text?.startsWith('Marca sugerida'))?.text,
    })),
    emissionStatus: params.emissionStatus ?? 'draft',
    registryLegend: params.registryLegend,
  };
}

function esc(value: string | undefined): string {
  return (value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('es-AR');
}

/** Renderiza la receta como documento HTML autocontenido. Puro. */
export function renderRecetaHtml(data: RecetaPrintData): string {
  const items = data.items
    .map(
      (item, i) => `
      <div class="rp">
        <div class="rp-head"><span class="rp-num">${i + 1}.</span> <span class="rp-med">${esc(item.medicamento)}</span>
          ${item.cantidad !== undefined ? `<span class="rp-qty">× ${item.cantidad}</span>` : ''}
        </div>
        ${item.posologia ? `<div class="rp-pos"><span class="k">Posología:</span> ${esc(item.posologia)}</div>` : ''}
        ${item.nota ? `<div class="rp-nota">${esc(item.nota)}</div>` : ''}
      </div>`
    )
    .join('');

  const logo = data.logoUrl
    ? `<img class="logo" src="${esc(data.logoUrl)}" alt="${esc(data.clinicName)}" onerror="this.style.display='none'" />`
    : '';

  const patientRows = [
    ['Paciente', data.patientName],
    ['DNI', data.patientDni],
    ['Nacimiento', fmtDate(data.patientBirthDate)],
    ['Cobertura', data.coverage],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><span class="k">${k}:</span> <span class="v">${esc(v)}</span></div>`)
    .join('');

  // El diagnóstico es obligatorio en la emisión; si un dato viejo no lo trae,
  // el documento evidencia el faltante con la línea para completar.
  const diagnosisBlock = `<div class="dx"><span class="k">Diagnóstico:</span> ${
    data.diagnostico ? esc(data.diagnostico) : '<span class="blank"></span>'
  }</div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Receta ${esc(data.recetaId)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 32px 40px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #b06a3b; padding-bottom: 12px; margin-bottom: 16px; }
  .logo { height: 44px; width: auto; }
  .clinic { font-size: 20px; font-weight: 700; color: #8a4a24; }
  .subtitle { color: #666; font-size: 12px; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15px; margin: 0; text-transform: uppercase; letter-spacing: .04em; }
  .doc-meta { color: #555; font-size: 12px; margin-top: 4px; }
  .doc-meta .ord { font-weight: 700; color: #1a1a1a; font-size: 14px; }
  .patient { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; background: #f7f4f1; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
  .patient .k { color: #777; }
  .patient .v { font-weight: 600; }
  .rp-title { font-size: 16px; font-weight: 700; color: #8a4a24; margin: 12px 0 4px; }
  .rp { border-bottom: 1px solid #eee; padding: 10px 4px; }
  .rp-num { color: #999; }
  .rp-med { font-weight: 700; font-size: 14px; }
  .rp-qty { color: #444; margin-left: 8px; }
  .rp-pos { margin-top: 4px; color: #333; }
  .rp-pos .k { font-weight: 600; color: #555; }
  .rp-nota { margin-top: 2px; color: #777; font-size: 12px; font-style: italic; }
  .dx { margin-top: 16px; font-size: 12px; color: #444; }
  .dx .k { font-weight: 600; }
  .dx .blank { display: inline-block; min-width: 280px; border-bottom: 1px solid #bbb; }
  .generico { margin-top: 12px; font-size: 11px; color: #777; }
  .sign { margin-top: 48px; display: flex; justify-content: flex-end; }
  .sign .box { text-align: center; min-width: 260px; border-top: 1px solid #333; padding-top: 6px; }
  .sign .name { font-weight: 600; }
  .sign .mat { color: #555; font-size: 12px; }
  .disclaimer { margin-top: 28px; border-top: 1px dashed #ccc; padding-top: 8px; color: #999; font-size: 10.5px; line-height: 1.5; }
  @media print { body { padding: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${logo}
      <div class="clinic">${esc(data.clinicName)}</div>
      <div class="subtitle">${esc(data.clinicSubtitle)}</div>
    </div>
    <div class="doc-title">
      <h1>Receta médica</h1>
      <div class="doc-meta">
        <div class="ord">${esc(data.recetaId)}</div>
        <div>${fmtDate(data.authoredOn)}</div>
      </div>
    </div>
  </div>

  <div class="patient">${patientRows}</div>

  <div class="rp-title">Rp/</div>
  ${items}

  ${diagnosisBlock}

  <div class="generico">Prescripción por nombre genérico (DCI), Ley 25.649. Las marcas sugeridas pueden sustituirse.</div>

  <div class="sign">
    <div class="box">
      <div class="name">${esc(data.practitionerName) || '&nbsp;'}</div>
      <div class="mat">${data.practitionerMatricula ? 'Matrícula ' + esc(data.practitionerMatricula) : 'Firma y sello del profesional'}</div>
      ${data.practitionerSpecialty ? `<div class="mat">${esc(data.practitionerSpecialty)}</div>` : ''}
    </div>
  </div>

  <div class="disclaimer">
    ${esc(EMISSION_STATUS[data.emissionStatus ?? 'draft'].legend)}
    Generado desde BioWellness · Seguimiento.${data.registryLegend ? ' ' + esc(data.registryLegend) : ''}
  </div>
</body>
</html>`;
}
