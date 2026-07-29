# R.A. Training CRM

Sistema de Gestión de Relaciones con Clientes para captación, cursos, inscripciones, seguimiento comercial, mensajes, pipeline, redes sociales y coordinación controlada con Moodle y R.A. Training Finance.

## Responsabilidades

- `ra-training.com`: catálogo e información comercial oficial.
- CRM: contactos, consentimiento, cursos de interés, inscripciones, agenda, mensajes, pipeline, campañas, redes y auditoría.
- Moodle: aula, contenido, avance y finalización real.
- R.A. Training Finance: fuente única de verdad para certificados, emisión, QR, anulación y verificación.

El CRM no emite certificados ni contiene una acción para hacerlo.

## Desarrollo local

Requisitos: Node.js 20 o superior y PostgreSQL.

```bash
npm ci
npx prisma validate
npm run db:migrate
npm run db:seed
npm run dev
```

Panel: `http://localhost:3000/admin`.

Para crear el primer usuario local se define temporalmente `CRM_ADMIN_PASSWORD` en la sesión de terminal y se ejecuta:

```bash
npm run admin:create -- --email=admin-local@example.test --name="Administrador local"
```

La contraseña no se pasa como argumento, no se almacena en semillas y se guarda con `scrypt`.

## Validación

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
git diff --check
```

## Seguridad operativa

- Las sesiones administrativas son firmadas, `httpOnly`, `sameSite=lax` y vencen a las ocho horas.
- Los roles son `ADMIN`, `MARKETING`, `VENTAS` y `LECTURA`.
- Los procesos programados requieren secreto en Producción.
- Finance y redes permanecen en simulación en desarrollo local.
- El webhook de Moodle permanece deshabilitado mientras no tenga secreto.
- No se registran contraseñas, hashes, tokens ni cuerpos completos de datos personales en auditoría.
- El acceso compartido anterior se conserva solo como compatibilidad temporal.

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Modelo de datos](docs/MODELO_DE_DATOS_CRM.md)
- [Integración de cursos](docs/INTEGRACION_CURSOS.md)
- [Integración Moodle](docs/INTEGRACION_MOODLE.md)
- [Integración Finance](docs/INTEGRACION_FINANCE.md)
- [Seguridad](docs/SEGURIDAD_CRM.md)
- [Migración a Producción](docs/MIGRACION_PRODUCCION.md)
- [Pruebas manuales](docs/PRUEBAS_MANUALES_CRM.md)
- [Candidato de release](docs/RELEASE_CANDIDATE.md)
- [Checklist de despliegue](docs/DEPLOYMENT_CHECKLIST.md)
- [Checklist de variables](docs/PRODUCTION_ENV_CHECKLIST.md)
- [Rollback](docs/ROLLBACK.md)
