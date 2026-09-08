# Vigía

Detecta pruebas que **pasan sin verificar nada**, y lo comenta en cada Pull
Request.

[![CI](https://github.com/eduardo-mr1/vigia/actions/workflows/ci.yml/badge.svg)](https://github.com/eduardo-mr1/vigia/actions/workflows/ci.yml)
[![Cobertura](https://img.shields.io/badge/cobertura-99.6%25%20líneas-brightgreen)](#calidad)
[![Tests](https://img.shields.io/badge/tests-129%20passing-brightgreen)](./src)
[![Licencia](https://img.shields.io/badge/licencia-MIT-blue)](./LICENSE)

---

## El problema

Una suite en verde no significa que el código funcione. Significa que ninguna
prueba falló, y una prueba que **no puede fallar** nunca lo hará.

```ts
it('calcula el total', () => {
  const total = sumar([10, 20]);
  // sin expect: pasa aunque sumar() devuelva basura
});

it('el carrito existe', () => {
  expect(true).toBe(true);   // comprueba JavaScript, no tu código
});

it('rechaza credenciales inválidas', async () => {
  expect(login('malo')).rejects.toThrow();   // sin await: la prueba ya terminó
});

it.only('suma con impuestos', () => { /* ... */ });  // silencia el resto de la suite
```

Jest reporta las cuatro como aprobadas. La cobertura ni siquiera baja: el código
**sí** se ejecutó, simplemente nadie miró el resultado.

Este proyecto nació de un caso real: una prueba E2E que hacía
`assertNotVisible` sobre un identificador que la app nunca generaba. Una
aserción negativa sobre algo que no puede existir pasa siempre. Llevaba semanas
en verde, dando confianza sobre el defecto más importante del sistema.

---

## Marcos soportados

| Marco | Cómo se detecta |
|---|---|
| Jest / Vitest | `it`, `test`, `describe`, `expect` |
| React Native Testing Library | `queryByTestId` en aserciones negativas |
| Playwright | Matchers asíncronos, activados por el import |
| Cypress | `.should()` y `.and()` cuentan como aserción |
| Chai | `assert.*` cuenta como aserción |
| Maestro | Flujos YAML, para aserciones negativas huérfanas |

Reconocer las aserciones de Cypress no es un extra: sin ello, **toda** prueba
de Cypress se reportaría como "sin aserción", porque ahí no se usa `expect`.
Una herramienta de calidad que se equivoca en un marco entero no se usa en
ninguno.

---

## Qué detecta

| Regla | Severidad | Qué encuentra |
|---|---|---|
| `sin-assercion` | P1 | Una prueba sin un solo `expect` |
| `expect-sin-matcher` | P1 | `expect(x)` sin matcher encadenado |
| `tautologia` | P1 | `expect(true).toBe(true)` y equivalentes |
| `prueba-enfocada` | P1 | `.only`, que silencia el resto de la suite en CI |
| `await-faltante` | P1 | Aserción asíncrona sin `await` — incluidos los matchers de Playwright |
| `prueba-omitida` | P3 | `.skip`, `xit`, `.todo` — cobertura que no existe |
| `assercion-negativa-huerfana` | P1 / P2 | Aserción negativa sobre un identificador que el código nunca produce |

Solo los **P1** rompen el build. Un P3 informa; hacerlo bloqueante enseña a
ignorar la herramienta.

---

## La aserción negativa huérfana

Es la regla que originó el proyecto, y la que ninguna otra herramienta hace.

```yaml
- assertNotVisible:
    id: "gasto-monto-9999-duplicado"   # este id no existe en la app
```

Pasa siempre. No porque el gasto no se duplique, sino porque ese elemento no
puede existir en ningún estado. La prueba está en verde y no comprueba nada.

Vigía cruza dos lados: qué identificadores puede producir el código fuente
(`testID="..."` y los construidos con `testID={\`gasto-${index}\`}`), y cuáles
esperan las pruebas. Lo que solo aparece en las pruebas es sospechoso.

La coincidencia por prefijo es ambigua a propósito, así que hay dos niveles:

| Situación | Severidad |
|---|---|
| El identificador no aparece por ningún lado | **P1** — la aserción pasa siempre |
| Coincide con un prefijo construido, pero el sufijo no parece un valor de interpolación | **P2** — sospechoso, revísalo |

`gasto-monto-9999-duplicado` cae en el segundo caso: el prefijo `gasto-monto-`
sí existe, pero `9999-duplicado` no es lo que produce un `${index}`. Reportarlo
como certeza sería mentir; callarlo, dejar pasar el bug.

Requiere indicar dónde está el código fuente:

```bash
npx vigia .maestro --src ./app
```

Sin `--src` la regla no se aplica: sin saber qué identificadores existen,
cualquier hallazgo sería una suposición.

---

## En acción

```bash
$ npx vigia src --src ./app
```

```
src/carrito.test.ts:8:3   P1  sin-assercion       La prueba "calcula el total" no contiene ninguna aserción.
src/carrito.test.ts:14:5  P1  expect-sin-matcher  expect() sin matcher encadenado.
src/carrito.test.ts:18:5  P1  tautologia          expect(true) comparado consigo mismo.
src/carrito.test.ts:21:3  P3  prueba-omitida      "valida el cupón vencido" está omitida.
src/carrito.test.ts:25:3  P1  prueba-enfocada     "suma con impuestos" usa .only: el resto no se ejecuta.

5 hallazgo(s): 4 P1, 0 P2, 1 P3
```

Cada hallazgo trae archivo, línea y columna: un clic desde el editor. Y una
sugerencia concreta — un hallazgo sin salida es solo un reproche.

Prueba tú mismo con el ejemplo incluido:

```bash
npm run build && node dist/cli.js ejemplo
```

---

## Uso como GitHub Action

```yaml
name: Calidad de pruebas

on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  vigia:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: eduardo-mr1/vigia@v1
        with:
          solo-cambios: 'true'
          codigo-fuente: './app'   # habilita la regla de aserciones huérfanas
```

Comenta en el PR con los hallazgos de los archivos que ese PR toca, y actualiza
el mismo comentario en cada push en lugar de acumular uno por commit.

| Entrada | Por defecto | Para qué |
|---|---|---|
| `ruta` | `.` | Directorio a analizar cuando no se limita al PR |
| `codigo-fuente` | — | Raíz del código; habilita la regla de aserciones huérfanas |
| `solo-cambios` | `true` | Analizar solo los archivos de prueba del PR |
| `fallar-en-p1` | `true` | Terminar el job con error si hay P1 |
| `comentar` | `true` | Publicar el resultado en el PR |

---

## Decisiones de diseño

### AST, no expresiones regulares

Un `expect` dentro de un comentario o de una cadena de texto no es una
aserción. Un regex no distingue la diferencia y produce falsos positivos; el
árbol sintáctico de TypeScript sí. Hay pruebas explícitas de ambos casos.

Esta regla no es teórica. La detección de aserciones huérfanas se escribió
primero con expresiones regulares, y **el autoanálisis de la propia herramienta
la delató**: marcaba código de ejemplo escrito dentro de una cadena en sus
propias pruebas. Siete falsos positivos en el primer intento. Se reescribió
sobre el AST.

Los flujos de Maestro sí se analizan como texto: YAML no tiene un árbol a mano
y su estructura es lo bastante plana para hacerlo sin ambigüedad.

Cuesta más escribirlo, pero una herramienta de calidad que se equivoca se
desinstala en la primera semana.

### Solo los P1 rompen el build

Una prueba omitida merece saberse, no bloquear un release. Cuando todo es
bloqueante, el equipo aprende a saltarse la herramienta — y entonces deja de
servir para lo que sí importa.

### Sin dependencias de runtime

`package.json` declara cero dependencias de producción. El compilador de
TypeScript ya trae el parser, y la Action corre el `dist` compilado. Una
herramienta que se instala en CI ajeno no debería arrastrar un árbol de
paquetes.

### Se analiza a sí misma

El CI corre `vigia` sobre su propio código en cada push. Si la herramienta no
soporta su propio criterio, no tiene por qué imponérselo a nadie.

---

## Calidad

| | |
|---|---|
| Pruebas | 129 |
| Cobertura | 99.6% de líneas, 88% de ramas |
| Dependencias de runtime | 0 |
| Lint | ESLint estricto, cero advertencias permitidas |
| Tipos | TypeScript `strict` con `noUncheckedIndexedAccess` |

```bash
npm test              # suite completa
npm run test:coverage # con umbrales
npm run lint
npm run typecheck
npm run build
```

---

## El `await` que falta

```ts
it('rechaza credenciales inválidas', async () => {
  expect(login('malo', 'malo')).rejects.toThrow();
});
```

`expect(...).rejects` devuelve una promesa. Sin `await` ni `return`, la prueba
termina antes de que se resuelva: el fallo se pierde, o aparece más tarde
atribuido a otro caso. Jest a veces avisa y a veces no, según la versión y
según si otra prueba absorbe el rechazo.

Es el defecto más común en suites asíncronas y el más difícil de ver leyendo,
porque la línea parece completa. Vigía sigue la cadena hasta la raíz: si el
`expect` lleva `.resolves` o `.rejects` y la expresión no está esperada ni
devuelta, la marca.

### En Playwright es aún peor

```ts
test('el botón aparece', async ({ page }) => {
  expect(page.locator('#guardar')).toBeVisible();   // sin await
});
```

En Playwright **toda** aserción sobre un locator es asíncrona: reintenta hasta
cumplirse o agotar el tiempo. Sin `await` la aserción se descarta entera. La
línea se ve idéntica a una síncrona, y por eso se cuela tanto.

Vigía activa los 24 matchers de Playwright solo cuando el archivo importa
`@playwright/test`. Sin ese import, `toBeVisible` es el matcher síncrono de
jest-dom o de React Native Testing Library, y exigir `await` sería un falso
positivo. Ambos casos tienen prueba.

---

## Estado

Siete reglas funcionando y probadas. En el roadmap:

- **Mapa de casos afectados** — qué casos del plan de pruebas toca cada PR
- **Delta de cobertura** contra la rama base
- **Pruebas idénticas** — dos casos con distinto nombre y el mismo cuerpo
- **`cy.get()` sin aserción en la cadena** — acciones sin verificación
- **Publicación en npm** — para que `npx vigia` funcione sin clonar el repo

---

## Autor

**Eduardo Maytorena** — Product Owner y QA Manager
Culiacán, Sinaloa, México

## Licencia

MIT — ver [LICENSE](./LICENSE).
