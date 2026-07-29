import { describe, expect, it, vi } from "vitest";
import {
  BASELINE_MIGRATION,
  BASELINE_TABLE_COLUMNS,
  INCREMENTAL_REQUIRED_COLUMNS,
  INCREMENTAL_TABLES,
  preparePreviewMigrations,
  RELEASE_MIGRATION,
} from "../../scripts/prepare-preview-migrations.mjs";

type Migration = { name: string; applied: boolean };
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

function finalSnapshot(): Snapshot {
  const baseline = baselineSnapshot([
    { name: BASELINE_MIGRATION, applied: true },
    { name: RELEASE_MIGRATION, applied: true },
  ]);
  return {
    tables: [...baseline.tables, ...INCREMENTAL_TABLES],
    columns: [...baseline.columns, ...INCREMENTAL_REQUIRED_COLUMNS],
    migrations: baseline.migrations,
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

  it("rechaza el incremental registrado sin baseline", async () => {
    const test = harness(finalSnapshot());
    test.inspect.mockResolvedValue({
      ...finalSnapshot(),
      migrations: [{ name: RELEASE_MIGRATION, applied: true }],
    });
    await expect(test.run()).rejects.toThrow("sin el baseline");
  });

  it("rechaza historial desconocido o incompleto", async () => {
    const test = harness(baselineSnapshot([{ name: "migracion_desconocida", applied: true }]));
    await expect(test.run()).rejects.toThrow("desconocidas");
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
