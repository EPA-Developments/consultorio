// Aviso de error de carga, compartido por los paneles clínicos.
//
// Existe por una clase de defecto que apareció en diez pantallas a la vez: el
// hook fallaba, atrapaba el error con console.error y la pantalla mostraba su
// estado vacío — "Sin alertas", "0/N con datos", "Sin órdenes emitidas" — como
// si fuera un hecho clínico. Para un médico, "no hay datos" y "no pude leer
// los datos" son afirmaciones opuestas: la primera autoriza a actuar (repetir
// una orden, no intensificar un tratamiento) y la segunda obliga a esperar.
//
// La regla que este componente materializa: NINGÚN estado vacío se muestra si
// la carga falló. Primero se pregunta "¿pude leer?", después "¿hay datos?".
import { Alert, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { JSX } from 'react';

export function ErrorCarga(props: { que: string }): JSX.Element {
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
      <Text size="sm" fw={600}>
        No se pudo cargar {props.que}
      </Text>
      <Text size="sm">
        Lo que falta acá no es un dato: es una falla de lectura. Recargá la página; si persiste, avisá al equipo
        técnico.
      </Text>
    </Alert>
  );
}
