import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  BASELINE_MIGRATION,
  BASELINE_TABLE_COLUMNS,
  COURSE_CAPTURE_MIGRATION,
  COURSE_CAPTURE_REQUIRED_COLUMNS,
  COURSE_SCHEDULE_MIGRATION,
  COURSE_SCHEDULE_REQUIRED_COLUMNS,
  INCREMENTAL_REQUIRED_COLUMNS,
  INCREMENTAL_TABLES,
  preparePreviewMigrations,
  REPOSITORY_MIGRATIONS,
  RELEASE_MIGRATION,
} from "../../scripts/prepare-preview-migrations.mjs";

type Migration = { name: string; applied: boolean; rolledBack?: boolean };
type Snapshot = { tables: string[]; columns: string[]; migrations: Migration[] };

const previewEnv = {
  VERCEL_ENV: "preview",
  PREVIEW_DATABASE_MIGRATIONS_ENABLED: "true",
  POSTGRES_URL_NON_POOLING: "postgresql://direct.example.test/preview",
};
const silentLogger = { info() {}, error() {} };

function baselineSnapshot(migrations: Migration[] = [], historyTable = migrations.length > 0): Snapshot {
  return {
    tables: [...Object.keys(BASELINE_TABLE_COLUMNS), ...(historyTable ? ["_prisma_migrations"] : [])],
    columns: Object.entries(BASELINE_TABLE_COLUMNS)
      .flatMap(([table, columns]) => columns.map((column: string) => `${table}.${column}`)),
    migrations,
  };
}

function releaseSnapshot(migrations: Migration[] = [
  { name: BASELINE_MIGRATION, applied: true },
  { name: RELEASE_MIGRATION, applied: true },
]): Snapshot {
  const baseline = baselineSnapshot([
    ...migrations,
  ]);
  return {
    tables: [...baseline.tables, ...INCREMENTAL_TABLES],
    columns: [...baseline.columns, ...INCREMENTAL_REQUIRED_COLUMNS],
    migrations: baseline.migrations,
  };
}

function finalSnapshot(migrations: Migration[] = REPOSITORY_MIGRATIONS.map((name: string) => ({
  name,
  applied: true,
}))): Snapshot {
  const release = releaseSnapshot(migrations);
  return {
    ...release,
    columns: [...release.columns, ...COURSE_SCHEDULE_REQUIRED_COLUMNS, ...COURSE_CAPTURE_REQUIRED_COLUMNS],
  };
}

function harness(snapshot: Snapshot, env = previewEnv, resolveImplementation?: () => Promise<void>) {
  const inspect = vi.fn(async () => snapshot);
  const resolveBaseline = vi.fn(resolveImplementation ?? (async () => {}));
  return {
    inspect,
    resolveBaseline,
    run: () => preparePreviewMigrations({
      env,
      inspect,
      resolveBaseline,
      logger: silentLogger as unknown as Console,
    }),
  };
}

describe("prepare-preview-migrations", () => {
  it("deja que migrate deploy inicialice una base vacía", async () => {
    const test = harness({ tables: [], columns: [], migrations: [] });
    await expect(test.run()).resolves.toEqual({ mode: "empty" });
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("marca únicamente el baseline en una base histórica exacta sin historial", async () => {
    const test = harness(baselineSnapshot());
    await expect(test.run()).resolves.toEqual({ mode: "resolve-baseline" });
    expect(test.resolveBaseline).toHaveBeenCalledOnce();
  });

  it("no repite resolve cuando el baseline ya está registrado", async () => {
    const test = harness(baselineSnapshot([{ name: BASELINE_MIGRATION, applied: true }]));
    await expect(test.run()).resolves.toEqual({ mode: "baseline-recorded" });
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("acepta baseline y release registrados con course_schedule_fields pendiente", async () => {
    const test = harness(releaseSnapshot());
    await expect(test.run()).resolves.toEqual({ mode: "migrations-pending" });
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("acepta course_schedule_fields registrada con la campana de captacion pendiente", async () => {
    const migrations = [BASELINE_MIGRATION, RELEASE_MIGRATION, COURSE_SCHEDULE_MIGRATION]
      .map((name) => ({ name, applied: true }));
    const release = releaseSnapshot(migrations);
    const test = harness({
      ...release,
      columns: [...release.columns, ...COURSE_SCHEDULE_REQUIRED_COLUMNS],
    });
    await expect(test.run()).resolves.toEqual({ mode: "migrations-pending" });
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("acepta historial y esquema final completos sin resolver de nuevo", async () => {
    const test = harness(finalSnapshot());
    await expect(test.run()).resolves.toEqual({ mode: "up-to-date" });
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("detiene un esquema ambiguo con tablas inesperadas", async () => {
    const snapshot = baselineSnapshot();
    snapshot.tables.push("tabla_desconocida");
    const test = harness(snapshot);
    await expect(test.run()).rejects.toThrow("no segura");
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("detiene un incremental parcialmente aplicado", async () => {
    const snapshot = baselineSnapshot();
    snapshot.columns.push("courses.category");
    const test = harness(snapshot);
    await expect(test.run()).rejects.toThrow("ambiguo");
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("Producción bloquea inspección y resolve", async () => {
    const test = harness(baselineSnapshot(), { ...previewEnv, VERCEL_ENV: "production" });
    await expect(test.run()).rejects.toThrow("solo está permitido");
    expect(test.inspect).not.toHaveBeenCalled();
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("Preview sin bandera bloquea inspección y resolve", async () => {
    const test = harness(baselineSnapshot(), {
      ...previewEnv,
      PREVIEW_DATABASE_MIGRATIONS_ENABLED: "false",
    });
    await expect(test.run()).rejects.toThrow("PREVIEW_DATABASE_MIGRATIONS_ENABLED");
    expect(test.inspect).not.toHaveBeenCalled();
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("propaga el fallo de migrate resolve y no lo disfraza como éxito", async () => {
    const test = harness(baselineSnapshot(), previewEnv, async () => {
      throw new Error("migrate resolve falló");
    });
    await expect(test.run()).rejects.toThrow("migrate resolve falló");
  });

  it("rechaza course_schedule_fields aplicada sin sus migraciones anteriores", async () => {
    const test = harness(finalSnapshot([{ name: COURSE_SCHEDULE_MIGRATION, applied: true }]));
    await expect(test.run()).rejects.toThrow("fuera de orden lógico");
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("rechaza una migración que no existe en prisma/migrations", async () => {
    const test = harness(baselineSnapshot([{
      name: "20260730000000_migracion_ajena_al_repositorio",
      applied: true,
    }]));
    await expect(test.run()).rejects.toThrow("desconocidas");
  });

  it("rechaza una migración fallida o incompleta", async () => {
    const test = harness(baselineSnapshot([{ name: BASELINE_MIGRATION, applied: false }]));
    await expect(test.run()).rejects.toThrow("fallida, revertida o incompleta");
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  it("rechaza una migración revertida", async () => {
    const test = harness(baselineSnapshot([{
      name: BASELINE_MIGRATION,
      applied: false,
      rolledBack: true,
    }]));
    await expect(test.run()).rejects.toThrow("fallida, revertida o incompleta");
    expect(test.resolveBaseline).not.toHaveBeenCalled();
  });

  for (const requiredColumn of COURSE_SCHEDULE_REQUIRED_COLUMNS) {
    it(`rechaza un esquema final sin ${requiredColumn}`, async () => {
      const snapshot = finalSnapshot();
      snapshot.columns = snapshot.columns.filter((column) => column !== requiredColumn);
      const test = harness(snapshot);
      await expect(test.run()).rejects.toThrow("esquema final");
      expect(test.resolveBaseline).not.toHaveBeenCalled();
    });
  }

  for (const requiredColumn of COURSE_CAPTURE_REQUIRED_COLUMNS) {
    it(`rechaza un esquema final sin ${requiredColumn}`, async () => {
      const snapshot = finalSnapshot();
      snapshot.columns = snapshot.columns.filter((column) => column !== requiredColumn);
      const test = harness(snapshot);
      await expect(test.run()).rejects.toThrow("esquema final");
      expect(test.resolveBaseline).not.toHaveBeenCalled();
    });
  }

  it("reconoce dinámicamente todas las carpetas de migración del repositorio", () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const migrationsDirectory = resolve(testDirectory, "../../prisma/migrations");
    const migrationDirectories = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    expect(REPOSITORY_MIGRATIONS).toEqual(migrationDirectories);
    expect(REPOSITORY_MIGRATIONS).toContain(COURSE_SCHEDULE_MIGRATION);
    expect(REPOSITORY_MIGRATIONS).toContain(COURSE_CAPTURE_MIGRATION);
  });

  it("solo ejecuta migrate resolve para el esquema baseline sin historial", async () => {
    const cases: Array<{ snapshot: Snapshot; resolvesBaseline: boolean }> = [
      { snapshot: { tables: [], columns: [], migrations: [] }, resolvesBaseline: false },
      { snapshot: baselineSnapshot(), resolvesBaseline: true },
      {
        snapshot: baselineSnapshot([{ name: BASELINE_MIGRATION, applied: true }]),
        resolvesBaseline: false,
      },
      { snapshot: releaseSnapshot(), resolvesBaseline: false },
      { snapshot: finalSnapshot(), resolvesBaseline: false },
    ];
    for (const scenario of cases) {
      const test = harness(scenario.snapshot);
      await test.run();
      expect(test.resolveBaseline).toHaveBeenCalledTimes(scenario.resolvesBaseline ? 1 : 0);
    }
  });

  it("redacta secretos presentes en errores del proceso de resolve", async () => {
    const secret = "preview-secret-value";
    const env = { ...previewEnv, POSTGRES_URL_NON_POOLING: `postgresql://user:${secret}@host/preview` };
    const test = harness(baselineSnapshot(), env, async () => {
      throw new Error(`fallo al usar postgresql://user:${secret}@host/preview`);
    });
    let message = "";
    try {
      await test.run();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(secret);
    expect(message).toContain("DATABASE_URL_REDACTED");
  });
});
