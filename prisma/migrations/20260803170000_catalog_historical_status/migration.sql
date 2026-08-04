-- Estado aditivo para distinguir cursos conservados fuera del catálogo vigente.
ALTER TYPE "CatalogSyncStatus" ADD VALUE IF NOT EXISTS 'HISTORICAL';
