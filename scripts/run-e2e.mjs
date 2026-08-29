import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = "3100";
const url = `http://127.0.0.1:${port}`;
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(
  root,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);
const e2eEnv = {
  ...process.env,
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_PUBLIC_USE_MOCK_DB: "true",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:
    "BGtkbcjrO12YMoDuq2sCQeHlu47uPx3SHTgFKZFYiBW8Qr0D9vgyZSZPdw6_4ZFEI9Snk1VEAj2qTYI1I1YxBXE",
  PUSH_DISPATCH_SECRET: "e2e-push-dispatch-secret",
};

let activeChild;
let shuttingDown = false;

function spawnChild(command, args) {
  return spawn(command, args, {
    cwd: root,
    env: e2eEnv,
    stdio: "inherit",
    windowsHide: true,
  });
}

async function run(command, args) {
  const child = spawnChild(command, args);
  activeChild = child;
  const [code, signal] = await once(child, "exit");
  activeChild = undefined;
  return code ?? (signal ? 1 : 0);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exitPromise = once(child, "exit");
  child.kill("SIGTERM");
  const exited = await Promise.race([
    exitPromise.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    const forcedExitPromise = once(child, "exit");
    child.kill("SIGKILL");
    await forcedExitPromise;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`E2E 서버가 시작 전에 종료됐습니다 (${server.exitCode}).`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`E2E 서버가 120초 안에 준비되지 않았습니다: ${url}`);
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  await stop(activeChild);
  await stop(server);
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

let server;
try {
  const buildCode = await run(process.execPath, [nextCli, "build"]);
  if (buildCode !== 0) process.exitCode = buildCode;
  else {
    server = spawnChild(process.execPath, [nextCli, "start", "-p", port]);
    activeChild = server;
    await waitForServer(server);
    activeChild = undefined;
    process.exitCode = await run(process.execPath, [playwrightCli, "test"]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stop(server);
}
