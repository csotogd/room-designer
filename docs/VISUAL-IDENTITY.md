# Identidad visual — Room Designer

Referencia solicitada: [Sklum España](https://www.sklum.com/es/), consultada el 12 de septiembre de 2026.

## Tipografía y color

La web de referencia declara `Azeret` como familia principal. Se han incluido los pesos 400, 500, 600 y 700 en `public/fonts/`, con `font-display: swap` y precarga del peso regular. Los archivos proceden de las URLs públicas `https://www.sklum.com/fonts/Azeret-{Regular,Medium,SemiBold,Bold}.woff2`; esta referencia de procedencia no concede una licencia tipográfica.

Valores observados en la hoja de estilos de Sklum:

| Uso | Color |
| --- | --- |
| Títulos y acción principal | `#191919` |
| Texto | `#2E2E2E` |
| Texto secundario | `#747474` |
| Borde | `#D2D2D2` |
| Separadores | `#E6E6E5` |
| Fondo piedra | `#EFECE6` |
| Piedra oscuro | `#DBD4C7` |
| Superficie | `#FFFFFF` |

Los tokens de la aplicación están centralizados al inicio de `src/style.css`. El lienzo utiliza un neutro claro derivado (`#F5F4F1`) y el plano un blanco cálido (`#F8F7F4`). Los colores del mobiliario y los acabados del proyecto no se sustituyen por los de la interfaz.

## Aplicación

- Se mantiene el nombre Room Designer y un símbolo geométrico propio.
- Tipografía sans serif en toda la interfaz; pesos medios, títulos contenidos y lectura clara de medidas.
- Botones rectos, radio de 2 px, bordes de 1 px y sombras reservadas para capas superpuestas.
- Catálogo, escena y asistente tienen áreas independientes; el tamaño del canvas se adapta al abrir o cerrar paneles.
- En ventanas inferiores a 1100 px el asistente funciona como cajón. Por debajo de 761 px también lo hace el catálogo, con un único cajón abierto a la vez.
- El modal mantiene el foco dentro del diálogo y se puede cerrar con Escape. Estados activos y controles con iconos tienen etiquetas accesibles.
- Las sugerencias del asistente preparan el texto para que el usuario pueda revisarlo antes de enviarlo.

Fuente de los tokens: [CSS principal de Sklum](https://www.sklum.com/es/themes/skl_v2/css/common-skl.css?v=20260910.71.01).
