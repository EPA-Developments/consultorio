// Impresión / PDF de una orden de laboratorio (recetario, Fase 1).
//
// Genera un documento HTML autocontenido (CSS inline) de una orden y lo manda a
// imprimir dentro de un iframe oculto: la impresión del navegador ofrece
// "Imprimir" y "Guardar como PDF" sin agregar ninguna dependencia. La parte
// pura (renderLabOrderHtml, buildPrintData) es testeable; solo printHtmlDocument
// toca el DOM.
//
// IMPORTANTE (Fase 1): este documento es de TRABAJO. La validez legal de la
// orden —firma electrónica del médico, inscripción/receta digital (ReNaPDiS,
// Res. 2214/2025)— corresponde a la Fase 2 y todavía no está implementada; el
// pie lo aclara para no inducir a error.
import { formatHumanName, getDisplayString } from '@medplum/core';
import type { Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { DNI_SYSTEM, getIdentifierValue, MATRICULA_SYSTEM } from '../ckm/argentina';

export interface LabOrderPrintItem {
  label: string;
  /** Código (LOINC o local). */
  code?: string;
}

export interface LabOrderPrintData {
  clinicName: string;
  clinicSubtitle?: string;
  /** URL del logo (solo en el navegador; se omite en tests). */
  logoUrl?: string;
  patientName: string;
  patientDni?: string;
  patientBirthDate?: string;
  coverage?: string;
  practitionerName?: string;
  practitionerMatricula?: string;
  /** Número de orden (requisition). */
  requisitionId: string;
  /** Fecha de autoría en ISO. */
  authoredOn: string;
  intent: 'order' | 'proposal';
  items: LabOrderPrintItem[];
  /** Indicaciones (ej. ayuno). */
  fastingNote?: string;
}

const CLINIC_NAME = 'BioWellness';
const CLINIC_SUBTITLE = 'Medicina Funcional y Longevidad · San Isidro, PBA';
const DEFAULT_FASTING =
  'Ayuno de 8 a 12 h para el perfil metabólico y lipídico. Concurrir con esta orden y credencial.';

/** Extrae la cobertura de la nota "Cobertura: X" de un ServiceRequest. */
export function coverageFromNote(req: ServiceRequest | undefined): string | undefined {
  const text = req?.note?.[0]?.text;
  const match = text?.match(/Cobertura:\s*(.+)/i);
  return match?.[1]?.trim() ?? undefined;
}

/**
 * Arma los datos de impresión a partir de los recursos FHIR de una orden (los
 * ServiceRequest de una misma requisición) + paciente + profesional. Puro: solo
 * lee campos, no hace I/O.
 */
export function buildPrintData(params: {
  requisitionId: string;
  requests: ServiceRequest[];
  patient: Patient;
  practitioner?: Practitioner;
  logoUrl?: string;
}): LabOrderPrintData {
  const { requests, patient, practitioner } = params;
  const first = requests[0];
  return {
    clinicName: CLINIC_NAME,
    clinicSubtitle: CLINIC_SUBTITLE,
    logoUrl: params.logoUrl,
    patientName: patient.name?.[0] ? formatHumanName(patient.name[0]) : getDisplayString(patient),
    patientDni: getIdentifierValue(patient, DNI_SYSTEM),
    patientBirthDate: patient.birthDate,
    coverage: coverageFromNote(first),
    practitionerName: practitioner?.name?.[0]
      ? formatHumanName(practitioner.name[0])
      : practitioner
        ? getDisplayString(practitioner)
        : undefined,
    practitionerMatricula: practitioner?.identifier?.find((i) => i.system === MATRICULA_SYSTEM)?.value,
    requisitionId: params.requisitionId,
    authoredOn: first?.authoredOn ?? '',
    intent: requests.some((r) => r.intent === 'proposal') ? 'proposal' : 'order',
    items: requests.map((r) => ({ label: r.code?.text ?? '(sin nombre)', code: r.code?.coding?.[0]?.code })),
    fastingNote: DEFAULT_FASTING,
  };
}

/** Escapa texto para insertarlo con seguridad en el HTML. */
function esc(value: string | undefined): string {
  return (value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Formatea una fecha ISO a dd/mm/aaaa (es-AR); cadena vacía si no hay. */
function fmtDate(iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('es-AR');
}

/**
 * Renderiza la orden como un documento HTML completo y autocontenido, listo
 * para imprimir. Puro (no toca el DOM): devuelve el string.
 */
export function renderLabOrderHtml(data: LabOrderPrintData): string {
  const isProposal = data.intent === 'proposal';
  const title = isProposal ? 'Solicitud de estudios' : 'Orden de laboratorio';
  const rows = data.items
    .map(
      (item, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${esc(item.label)}</td>
          <td class="code">${esc(item.code)}</td>
        </tr>`
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

  const proposalBanner = isProposal
    ? `<div class="banner">Solicitud generada por el paciente. Requiere revisión y emisión del médico.</div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(title)} ${esc(data.requisitionId)}</title>
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
  .banner { background: #fff4e6; border: 1px solid #f0a860; color: #a6560f; padding: 6px 10px; border-radius: 4px; margin-bottom: 12px; font-size: 12px; }
  .patient { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; background: #f7f4f1; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
  .patient .k { color: #777; }
  .patient .v { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #777; border-bottom: 1px solid #ccc; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  td.num { color: #999; width: 32px; }
  td.code { color: #777; font-variant-numeric: tabular-nums; width: 110px; }
  .count { margin-top: 8px; color: #555; font-size: 12px; }
  .fasting { margin-top: 16px; font-size: 12px; color: #444; }
  .fasting .k { font-weight: 600; }
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
      <h1>${esc(title)}</h1>
      <div class="doc-meta">
        <div class="ord">${esc(data.requisitionId)}</div>
        <div>${fmtDate(data.authoredOn)}</div>
      </div>
    </div>
  </div>

  ${proposalBanner}

  <div class="patient">${patientRows}</div>

  <table>
    <thead>
      <tr><th>#</th><th>Estudio solicitado</th><th>Código</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="count">${data.items.length} ${data.items.length === 1 ? 'estudio solicitado' : 'estudios solicitados'}</div>

  ${data.fastingNote ? `<div class="fasting"><span class="k">Indicaciones:</span> ${esc(data.fastingNote)}</div>` : ''}

  <div class="sign">
    <div class="box">
      <div class="name">${esc(data.practitionerName) || '&nbsp;'}</div>
      <div class="mat">${data.practitionerMatricula ? 'Matrícula ' + esc(data.practitionerMatricula) : 'Firma y sello del profesional'}</div>
    </div>
  </div>

  <div class="disclaimer">
    Documento de trabajo generado desde BioWellness · Seguimiento. La validez legal de la orden
    (firma electrónica del profesional e inscripción en el sistema de recetas/órdenes digitales, Ley 27.553 y
    Res. 2214/2025) corresponde a una etapa posterior y no está garantizada por este documento.
  </div>
</body>
</html>`;
}

/**
 * Imprime un documento HTML en un iframe oculto (evita bloqueadores de popups y
 * no altera el layout de la app). No-op fuera del navegador.
 */
export function printHtmlDocument(html: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  let done = false;
  const trigger = (): void => {
    if (done) {
      return;
    }
    done = true;
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  win.onload = trigger;
  // Fallback por si onload no dispara (contenido ya listo, sin recursos externos).
  setTimeout(trigger, 500);
}
