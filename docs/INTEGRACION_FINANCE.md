# Integración con R.A. Training Finance

Finance es la única fuente de verdad para certificados. El CRM crea una inscripción por curso, guarda la referencia, muestra el último estado conocido y permite un reintento controlado.

## Garantías

- El cliente no contiene una función de emisión.
- Desarrollo local siempre simula, aunque alguien configure `FINANCE_MODE=live`.
- Una referencia pertenece a una sola `Enrollment`.
- Un error conserva la inscripción y registra `ERROR`.
- Una referencia existente se reutiliza de forma idempotente.
- No se generan PDF, QR, códigos de certificado, anulaciones o reemisiones.

## Limitación

El cliente envía un `POST` JSON y nunca coloca usuario, contraseña o token en la URL. El contrato POST, los permisos y una operación estable de consulta de estado deben confirmarse contra un entorno aislado de Finance antes de activar `FINANCE_MODE=live`. El CRM muestra el último estado recibido y no afirma `EMITIDO` sin confirmación de Finance.
