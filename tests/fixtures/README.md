# Test fixtures

These files are test inputs and expected outputs. The tests read them as text, then transform,
compile, or execute them. Use the links below to find the test that owns each fixture.

| File                                                     | Purpose                                                                                       | Used by                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [core-consumer.ts](core-consumer.ts)                     | Core assertions compiled alone or alongside the DOM fixture; never executed.                  | [core-package.test.ts](../core-package.test.ts), [types.test.ts](../types.test.ts) |
| [dom-consumer.ts](dom-consumer.ts)                       | DOM and core interoperability assertions compiled against installed packages; never executed. | [types.test.ts](../types.test.ts)                                                  |
| [contracts.input.d.ts](contracts.input.d.ts)             | Sample asynchronous declarations passed to the transformer.                                   | [declarations.test.ts](../declarations.test.ts)                                    |
| [contracts.expected.d.ts](contracts.expected.d.ts)       | Independently authored synchronous declarations compared with the transformed input.          | [declarations.test.ts](../declarations.test.ts)                                    |
| [declarations.rejected.json](declarations.rejected.json) | Named declaration snippets that the transformer must reject.                                  | [declarations.test.ts](../declarations.test.ts)                                    |
| [semantics.input.js](semantics.input.js)                 | JavaScript executed before and after transformation to compare behavior and event order.      | [transform.test.ts](../transform.test.ts)                                          |
| [measurement.js](measurement.js)                         | Runtime checks for synchronous positioning and shared core exports in an installed consumer.  | [packages.test.ts](../packages.test.ts)                                            |
| [layout.html](layout.html)                               | Browser layout for comparing generated and upstream positioning.                              | [layout.spec.ts](../browser/layout.spec.ts)                                        |
| [environment.d.ts](environment.d.ts)                     | Editor declarations for values supplied by the runtime test harnesses.                        | [Local TypeScript configuration](tsconfig.json)                                    |
| [tsconfig.json](tsconfig.json)                           | Local type-checking and import resolution for editing the source fixtures.                    | The editor and the explicit compiler command below.                                |

The declaration pair's exported names, such as `Platform` and `Middleware`, are example syntax
whose transformation is checked. They are not imported as APIs elsewhere in the repository.
Keep the pair's shared header aligned: the comparison also checks preserved comments.

`measurement.js` receives `core` and `dom` from imports or `require` calls prepended by
[packages.test.ts](../packages.test.ts). That test also reads the fixture's `platform` and `b`
variables when comparing with upstream. `semantics.input.js` receives `events`, `measure`, and
`fail` from the `context()` function in [transform.test.ts](../transform.test.ts).
[environment.d.ts](environment.d.ts) describes these values but does not create them.

Build the packages before editing or checking the fixtures. From the repository root:

```sh
npm run build
npx tsc --project tests/fixtures/tsconfig.json
```

The editor configuration points to local generated declarations. The installed-package tests
substitute actual package names and compile temporary copies of the consumer fixtures without those
mappings, so package-resolution defects remain detectable. `npm run check` includes the editor check
above as well as the installed-package compiler tests.
