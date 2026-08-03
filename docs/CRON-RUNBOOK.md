# Operación del cron del CRM

Estado requerido: el workflow `.github/workflows/automation-cron.yml` debe existir en la rama predeterminada `main`. GitHub ejecuta los eventos `schedule` exclusivamente desde la rama predeterminada; tener el archivo en otra rama no actualiza el job activo.

## Riesgo identificado

Durante la auditoría del 3 de agosto de 2026, la rama predeterminada observada era `claude/ra-training-automation-gr6j6y`. Por eso el cron activo podía continuar ejecutando una revisión histórica aunque `main` y las ramas de CRM avanzaran.

## Cambio administrativo pendiente

Un administrador del repositorio debe verificar que `main` contiene el workflow validado y después cambiar la rama predeterminada a `main` desde GitHub Settings → Branches. No se debe ejecutar este cambio desde una automatización ni sin autorización administrativa.

El workflow nuevo falla de forma visible si GitHub informa una rama predeterminada distinta de `main`, utiliza `curl --fail-with-body`, timeout, reintentos limitados y concurrencia única. Un HTTP 4xx/5xx ya no puede aparecer como ejecución exitosa.

## Activación

1. Validar el workflow en la rama de Preview.
2. Integrar el commit aprobado en `main`.
3. Confirmar el secreto `CRON_SECRET` sin imprimirlo.
4. Cambiar la rama predeterminada a `main` con autorización administrativa.
5. Ejecutar `workflow_dispatch` una vez y comprobar ambos HTTP 2xx.
6. Confirmar en auditoría que no hubo dobles ejecuciones ni envíos reales no autorizados.

El cron no activa proveedores: `MESSAGING_MODE` y `SOCIAL_MODE` conservan el control de simulación.
