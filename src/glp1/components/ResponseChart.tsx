// Gráfico de una métrica contra las fechas del plan.
//
// SVG propio y no chart.js: lo que hace falta acá es dibujar la serie CON las
// marcas verticales de los controles y la línea del objetivo, y eso en chart.js
// pide el plugin de anotaciones. El eje x es temporal de verdad (no por índice),
// porque las mediciones no caen a intervalos regulares y espaciarlas parejo
// mentiría sobre cuándo pasó cada cosa.
import { Box, Group, Text } from '@mantine/core';
import type { JSX } from 'react';
import type { DatedValue, MetricResponse } from '../response';

export interface PlanMarker {
  date: string;
  label: string;
}

const ANCHO = 640;
const ALTO = 170;
const PAD = { top: 12, right: 14, bottom: 26, left: 44 };

function ms(date: string): number {
  return new Date(date).getTime();
}

export function ResponseChart(props: {
  metric: MetricResponse;
  markers: PlanMarker[];
  /** Fecha de la revisión de respuesta, que se resalta. */
  reviewDate?: string;
}): JSX.Element | null {
  const { metric, markers } = props;
  const puntos = metric.points;
  if (puntos.length === 0) {
    return null;
  }

  // El dominio temporal cubre las mediciones Y los controles previstos, para
  // que se vea cuánto falta y no solo lo ya medido.
  const fechas = [...puntos.map((p) => ms(p.date)), ...markers.map((m) => ms(m.date))];
  const t0 = Math.min(...fechas);
  const t1 = Math.max(...fechas);
  const spanT = t1 - t0 || 1;

  const valores = puntos.map((p) => p.value);
  const vMin = Math.min(...valores);
  const vMax = Math.max(...valores);
  // Un poco de aire arriba y abajo; si la serie es plana, se inventa un rango
  // mínimo para que la línea no quede pegada al borde.
  const margen = (vMax - vMin || Math.abs(vMax) * 0.05 || 1) * 0.15;
  const yMin = vMin - margen;
  const yMax = vMax + margen;

  const x = (date: string): number => PAD.left + ((ms(date) - t0) / spanT) * (ANCHO - PAD.left - PAD.right);
  const y = (v: number): number =>
    ALTO - PAD.bottom - ((v - yMin) / (yMax - yMin || 1)) * (ALTO - PAD.top - PAD.bottom);

  const linea = puntos.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const basal = metric.baseline;

  return (
    <Box>
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        width="100%"
        role="img"
        aria-label={`${metric.label} a lo largo del plan`}
        style={{ overflow: 'visible' }}
      >
        {/* Controles previstos */}
        {markers.map((m) => {
          const esRevision = props.reviewDate === m.date;
          return (
            <g key={`${m.date}-${m.label}`}>
              <line
                x1={x(m.date)}
                x2={x(m.date)}
                y1={PAD.top}
                y2={ALTO - PAD.bottom}
                stroke={
                  esRevision ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-gray-4)'
                }
                strokeWidth={esRevision ? 1.5 : 1}
                strokeDasharray={esRevision ? undefined : '3 3'}
              />
              <text
                x={x(m.date)}
                y={ALTO - PAD.bottom + 14}
                textAnchor="middle"
                fontSize={9}
                fill="var(--mantine-color-dimmed)"
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {/* Nivel basal, para leer la distancia de un vistazo */}
        {basal && (
          <line
            x1={PAD.left}
            x2={ANCHO - PAD.right}
            y1={y(basal.value)}
            y2={y(basal.value)}
            stroke="var(--mantine-color-gray-5)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        )}

        {/* Serie */}
        <polyline
          points={linea}
          fill="none"
          stroke="var(--mantine-color-blue-6)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {puntos.map((p) => (
          <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={3} fill="var(--mantine-color-blue-6)" />
        ))}

        {/* Extremos del eje y */}
        <text x={PAD.left - 6} y={y(vMax) + 3} textAnchor="end" fontSize={10} fill="var(--mantine-color-dimmed)">
          {formatValue(vMax)}
        </text>
        <text x={PAD.left - 6} y={y(vMin) + 3} textAnchor="end" fontSize={10} fill="var(--mantine-color-dimmed)">
          {formatValue(vMin)}
        </text>
      </svg>

      <Group gap="lg" mt={4}>
        <Extremo titulo="Basal" punto={basal} unidad={metric.unit} />
        <Extremo titulo="Último" punto={metric.latest} unidad={metric.unit} />
        {metric.percentChange !== undefined && (
          <div>
            <Text size="xs" c="dimmed">
              Cambio
            </Text>
            <Text size="sm" fw={600} c={metric.improving ? 'teal' : 'orange'}>
              {metric.percentChange > 0 ? '+' : ''}
              {metric.percentChange.toFixed(1)} %
            </Text>
          </div>
        )}
      </Group>
    </Box>
  );
}

function Extremo(props: { titulo: string; punto?: DatedValue; unidad?: string }): JSX.Element | null {
  if (!props.punto) {
    return null;
  }
  return (
    <div>
      <Text size="xs" c="dimmed">
        {props.titulo} · {props.punto.date.slice(0, 10)}
      </Text>
      <Text size="sm" fw={600}>
        {formatValue(props.punto.value)} {props.unidad ?? ''}
      </Text>
    </div>
  );
}

function formatValue(v: number): string {
  return Math.abs(v) < 20 ? v.toFixed(1) : String(Math.round(v));
}
