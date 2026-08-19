# Activos públicos

Vite sirve los archivos de esta carpeta en la raíz del sitio (`/`).

## Logo de marca

Colocá el logo de **Favaloro | Medplum Argentina** acá como **`logo.png`** (o
`logo.svg`). Lo usan el header, el login y la landing vía el componente
`BrandLogo` (`src/components/BrandLogo.tsx`), que lo referencia como
`/logo.png`, y el favicon (`index.html`).

Mientras el archivo no exista, la app muestra un wordmark de respaldo
("Favaloro | Medplum Argentina", cobre sobre neutro), así que nunca se ve una
imagen rota.

Recomendado: PNG con fondo transparente, ~512×512 px o mayor (la imagen se
escala por alto manteniendo proporción).

El texto del wordmark de respaldo sale de `src/brand.ts`, no de este archivo.
