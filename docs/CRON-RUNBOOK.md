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

## Frecuencia requerida (actualización del 6 de agosto de 2026)

El workflow pasó de `*/15` a `*/5` minutos. El motivo es funcional: el
recordatorio de 15 minutos antes de cada sesión no puede depender de un reloj de
15 minutos, porque en el peor caso saldría justo al empezar la sesión. Cinco
minutos es además la frecuencia mínima que admite `schedule` en GitHub Actions.

El plan Hobby de Vercel solo permite ejecuciones diarias, por eso el reloj vive
en GitHub Actions y no en `vercel.json`. La lógica no está acoplada a ningún
proveedor de cron: cualquier programador externo que pueda enviar una cabecera
`Authorization: Bearer <CRON_SECRET>` cada cinco minutos a
`/api/nurture/dispatch` y `/api/social/publish` cumple la misma función.

Ambos endpoints son idempotentes: una ejecución repetida no duplica correos ni
publicaciones.
