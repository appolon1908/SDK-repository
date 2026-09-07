import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";

export class RedisTestServer {
  url = "";
  private directory = "";
  private port = 0;
  private process?: ChildProcess;
  private readonly container = `codestra-sdk-replay-${randomUUID()}`;
  constructor(private readonly appendOnly = true) {}

  async start(): Promise<void> {
    const binary = process.env.SDK_REDIS_SERVER_BIN;
    if (binary) {
      this.directory ||= await mkdtemp(join(tmpdir(), "codestra-replay-"));
      if (!this.port) {
        const probe = createServer();
        await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
        const address = probe.address();
        if (!address || typeof address === "string") throw new Error("Could not allocate test port");
        this.port = address.port;
        await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
      }
      const child = spawn(binary, ["--bind", "127.0.0.1", "--port", String(this.port), "--dir", this.directory,
        "--appendonly", this.appendOnly ? "yes" : "no", "--appendfsync", "always", "--save", ""], { stdio: ["ignore", "pipe", "pipe"] });
      this.process = child;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Redis test server did not start")), 10_000);
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Redis test server exited: ${code}`)); });
        child.stdout!.on("data", (chunk) => {
          if (String(chunk).includes("Ready to accept connections")) { clearTimeout(timeout); resolve(); }
        });
      });
      this.url = `redis://127.0.0.1:${this.port}`;
    } else {
      const image = process.env.SDK_REDIS_TEST_IMAGE;
      if (!image || !/^redis@sha256:[a-f0-9]{64}$/u.test(image)) throw new Error("A pinned SDK_REDIS_TEST_IMAGE or local SDK_REDIS_SERVER_BIN is required");
      execFileSync("docker", ["run", "--detach", "--name", this.container, "--publish", "127.0.0.1::6379",
        image, "redis-server", "--appendonly", this.appendOnly ? "yes" : "no", "--appendfsync", "always", "--save", ""], { stdio: "pipe" });
      const mappings = JSON.parse(execFileSync("docker", ["inspect", this.container], { encoding: "utf8" }));
      this.port = Number(mappings[0].NetworkSettings.Ports["6379/tcp"][0].HostPort);
      this.url = `redis://127.0.0.1:${this.port}`;
    }
    await this.ready();
  }

  async restart(): Promise<void> {
    if (this.process) {
      const process = this.process;
      const stopped = new Promise<void>((resolve) => process.once("exit", () => resolve()));
      process.kill("SIGKILL");
      await stopped;
      await this.start();
    } else {
      execFileSync("docker", ["kill", "--signal", "KILL", this.container], { stdio: "pipe" });
      execFileSync("docker", ["wait", this.container], { stdio: "pipe" });
      execFileSync("docker", ["start", this.container], { stdio: "pipe" });
      const mappings = JSON.parse(execFileSync("docker", ["inspect", this.container], { encoding: "utf8" }));
      this.port = Number(mappings[0].NetworkSettings.Ports["6379/tcp"][0].HostPort);
      this.url = `redis://127.0.0.1:${this.port}`;
      await this.ready();
    }
  }

  async ready(): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const client = createClient({ url: this.url, socket: { reconnectStrategy: false, connectTimeout: 200 } });
      client.on("error", () => {});
      try { await client.connect(); await client.ping(); return; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      finally { if (client.isOpen) client.destroy(); }
    }
    throw new Error("Redis test readiness failed");
  }

  async close(): Promise<void> {
    if (this.process) {
      const process = this.process;
      if (process.exitCode === null && process.signalCode === null) {
        const stopped = new Promise<void>((resolve) => process.once("exit", () => resolve()));
        process.kill("SIGTERM"); await stopped;
      }
      await rm(this.directory, { recursive: true, force: true });
    } else {
      try { execFileSync("docker", ["rm", "--force", "--volumes", this.container], { stdio: "pipe" }); } catch {}
    }
  }
}
