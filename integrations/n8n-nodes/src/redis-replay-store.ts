import { createClient } from "redis";
import { InboundEventError } from "./inbound-error.js";

export interface ReplayClaim {
  tenantId: string;
  eventId: string;
  bodySha256: string;
  retentionSeconds: number;
}

export interface RedisReplayConfig {
  url: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}

/** Security replay state only: this store cannot dispatch a business command. */
export async function claimDurableReplay(config: RedisReplayConfig, claim: ReplayClaim): Promise<void> {
  const client = createClient({
    url: config.url,
    ...(config.username === undefined ? {} : { username: config.username }),
    ...(config.password === undefined ? {} : { password: config.password }),
    socket: { connectTimeout: config.timeoutMs, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
  // Never log Redis errors: they can include connection/credential material.
  client.on("error", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = async () => {
    await client.connect();
    const memory = await client.info("memory");
    if (!/^maxmemory_policy:noeviction\r?$/mu.test(memory)) {
      throw new InboundEventError("REPLAY_EVICTION_POLICY_UNSAFE", 503);
    }
    const key = `codestra:n8n:replay:${claim.tenantId}:${claim.eventId}`;
    const result = await client.set(key, claim.bodySha256, { NX: true, EX: claim.retentionSeconds });
    if (result !== "OK") throw new InboundEventError("REPLAY_DETECTED", 409);
    // Redis 7.2+: require the claim to be fsynced locally before workflow dispatch.
    // An unavailable/disabled AOF or ambiguous response never authorizes dispatch.
    const persisted = await client.sendCommand(["WAITAOF", "1", "0", String(config.timeoutMs)]);
    if (!Array.isArray(persisted) || persisted[0] !== 1) {
      throw new InboundEventError("REPLAY_DURABILITY_UNCONFIRMED", 503);
    }
  };
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new InboundEventError("REPLAY_STORE_UNAVAILABLE", 503)), config.timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof InboundEventError) throw error;
    throw new InboundEventError("REPLAY_STORE_UNAVAILABLE", 503);
  } finally {
    clearTimeout(timer);
    if (client.isOpen) client.destroy();
    // Do not delete the claim after a timeout or uncertain post-claim outcome.
  }
}
