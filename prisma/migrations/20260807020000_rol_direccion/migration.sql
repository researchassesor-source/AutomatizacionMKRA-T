-- Perfil de direccion.
--
-- Migracion aditiva: solo anade un valor al enum de roles. Ningun usuario
-- cambia de rol, ninguna fila se toca. El unico usuario existente sigue
-- siendo ADMIN.
--
-- PostgreSQL 12+ admite ALTER TYPE ... ADD VALUE dentro de una transaccion
-- mientras el valor nuevo no se USE en la misma transaccion. Aqui solo se
-- declara.
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'DIRECCION' AFTER 'ADMIN';
