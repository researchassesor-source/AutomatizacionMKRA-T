import { describe, expect, it } from "vitest";
import { runVercelBuild } from "../../scripts/vercel-build.mjs";

const silentLogger = { info() {}, error() {} };
type Command = string[];
type Environment = Record<string, string>;

function harness(env: Environment, failureMatcher?: (call: Command) => boolean) {
  const calls: Command[] = [];
  const runner = (command: string, args: string[]) => {
    calls.push([command, ...args]);
    return {
      pid: 1,
      status: failureMatcher?.([command, ...args]) ? 1 : 0,
      signal: null,
      output: [null, "", ""],
      stdout: "",
      stderr: "",
    };
  };
  return {
    calls,
    run: () => runVercelBuild({
      env: env as NodeJS.ProcessEnv,
      runner,
      logger: silentLogger as unknown as Console,
      cwd: "/workspace",
    }),
  };
}

const previewEnv = {
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  PREVIEW_DATABASE_MIGRATIONS_ENABLED: "true",
  POSTGRES_PRISMA_URL: "postgresql://runtime.example.test/preview",
  POSTGRES_URL_NON_POOLING: "postgresql://direct.example.test/preview",
};

describe("vercel-build", () => {
  it("ejecuta el flujo completo y ordenado en Preview", () => {
    const test = harness(previewEnv);
    test.run();
    expect(test.calls).toHaveLength(6);
    expect(test.calls[0].slice(-1)).toEqual(["validate"]);
    expect(test.calls[1].slice(-2)).toEqual(["migrate", "deploy"]);
    expect(test.calls[2].slice(-2)).toEqual(["migrate", "status"]);
    expect(test.calls[3].slice(-1)).toEqual(["generate"]);
    expect(test.calls[4][1]).toMatch(/verify-database-schema\.mjs$/);
    expect(test.calls[5].slice(-1)).toEqual(["build"]);
  });

  it("bloquea Preview sin la bandera explícita antes de ejecutar comandos", () => {
    const test = harness({ ...previewEnv, PREVIEW_DATABASE_MIGRATIONS_ENABLED: "false" });
    expect(test.run).toThrow("PREVIEW_DATABASE_MIGRATIONS_ENABLED");
    expect(test.calls).toHaveLength(0);
  });

  it("Producción valida y compila sin migrar", () => {
    const test = harness({ VERCEL_ENV: "production" });
    test.run();
    const commands = test.calls.map((call) => call.join(" "));
    expect(commands).toHaveLength(3);
    expect(commands.some((command) => command.includes("migrate"))).toBe(false);
    expect(commands.at(-1)).toContain("next build");
  });

  it("desarrollo compila sin migrar", () => {
    const test = harness({});
    test.run();
    expect(test.calls.map((call) => call.join(" ")).some((command) => command.includes("migrate"))).toBe(false);
    expect(test.calls).toHaveLength(2);
  });

  it("detiene el flujo cuando migrate deploy falla", () => {
    const test = harness(previewEnv, (call) => call.join(" ").includes("migrate deploy"));
    expect(test.run).toThrow("Aplicando migraciones");
    expect(test.calls.map((call) => call.join(" ")).some((command) => command.includes("migrate status"))).toBe(false);
    expect(test.calls.map((call) => call.join(" ")).some((command) => command.includes("next build"))).toBe(false);
  });

  it("detiene el flujo cuando migrate status falla", () => {
    const test = harness(previewEnv, (call) => call.join(" ").includes("migrate status"));
    expect(test.run).toThrow("Comprobando el estado");
    expect(test.calls.map((call) => call.join(" ")).some((command) => command.includes("next build"))).toBe(false);
  });

  it("informa variables faltantes sin exponer conexiones", () => {
    const hidden = "private-password-that-must-not-leak";
    const test = harness({
      ...previewEnv,
      POSTGRES_PRISMA_URL: `postgresql://user:${hidden}@runtime.example.test/preview`,
      POSTGRES_URL_NON_POOLING: "",
    });
    let message = "";
    try {
      test.run();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("POSTGRES_URL_NON_POOLING");
    expect(message).not.toContain(hidden);
    expect(test.calls).toHaveLength(0);
  });
});
