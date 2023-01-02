import { encode } from "https://deno.land/std@0.170.0/encoding/base64.ts";
import { Cron } from "https://deno.land/x/crontab@0.1.1-1/cron.ts";

const encoder = new TextEncoder();

export interface TwitterRequest {
  method: "GET" | "POST";
  url: string;
  params?: Record<string, string>;
}

function getEnv(name: string): string {
  const env = Deno.env.get(name);

  if (typeof env === "undefined") {
    throw new Error(`Env ${name} is not defined`);
  }

  return env;
}

export interface OauthConfig {
  readonly consumerKey: string;
  readonly consumerSecret: string;
  readonly token: string;
  readonly tokenSecret: string;
}

export class TwitterApi {
  readonly #oauth: OauthConfig;

  #signKey?: CryptoKey;

  constructor(oauth: OauthConfig) {
    this.#oauth = oauth;
  }

  async init(): Promise<void> {
    const signKey = `${encodeURIComponent(
      this.#oauth.consumerSecret
    )}&${encodeURIComponent(this.#oauth.tokenSecret)}`;

    this.#signKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signKey),
      { name: "HMAC", hash: "SHA-1" },
      true,
      ["sign"]
    );
  }

  async send<T>(req: TwitterRequest): Promise<T> {
    const paramString = Object.entries(req.params ?? {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("=");

    const resp = await fetch(`${req.url}?${paramString}`, {
      method: req.method,
      headers: {
        Authorization: await this.#auth(req),
      },
    });

    const body = await resp.json();

    if (!resp.ok) {
      throw new Error(`Request failed: ${JSON.stringify(body)}`);
    }

    return body;
  }

  async #auth({ method, url, params }: TwitterRequest): Promise<string> {
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);

    const oauth = {
      oauth_consumer_key: this.#oauth.consumerKey,
      oauth_nonce: encode(nonceBytes),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(new Date().getTime() / 1000),
      oauth_token: this.#oauth.token,
      oauth_version: "1.0",
    };

    const paramString = Object.entries({ ...oauth, ...params })
      .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map((kv) => kv.join("="))
      .join("&");

    const signatureBase = `${method.toUpperCase()}&${encodeURIComponent(
      url
    )}&${encodeURIComponent(paramString)}`;

    if (!this.#signKey) {
      throw new Error("Client not initialised");
    }

    const signature = await crypto.subtle.sign(
      "HMAC",
      this.#signKey,
      encoder.encode(signatureBase)
    );

    const fullOauthString = Object.entries({
      ...oauth,
      oauth_signature: encode(signature),
    })
      .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
      .join(",");

    return `OAuth ${fullOauthString}`;
  }
}

const clockFaces: Record<number, { hour: string; half: string }> = {
  0: { hour: "🕛", half: "🕧" },
  1: { hour: "🕐", half: "🕜" },
  2: { hour: "🕑", half: "🕝" },
  3: { hour: "🕒", half: "🕞" },
  4: { hour: "🕓", half: "🕟" },
  5: { hour: "🕔", half: "🕠" },
  6: { hour: "🕕", half: "🕡" },
  7: { hour: "🕖", half: "🕢" },
  8: { hour: "🕗", half: "🕣" },
  9: { hour: "🕘", half: "🕤" },
  10: { hour: "🕙", half: "🕥" },
  11: { hour: "🕚", half: "🕦" },
};
const emojiLength = 2;
const allFaces: Set<string> = new Set(
  Object.values(clockFaces).flatMap(({ hour, half }) => [hour, half])
);

export function oauthEnvConfig(): OauthConfig {
  return {
    consumerKey: getEnv("OAUTH_CONSUMER_KEY"),
    consumerSecret: getEnv("OAUTH_CONSUMER_SECRET"),
    token: getEnv("OAUTH_TOKEN"),
    tokenSecret: getEnv("OAUTH_TOKEN_SECRET"),
  };
}

export async function updateName() {
  const api = new TwitterApi(oauthEnvConfig());
  await api.init();

  const {
    data: { name },
  } = await api.send<{ data: { id: string; name: string; username: string } }>({
    method: "GET",
    url: "https://api.twitter.com/2/users/1297629303153328129",
  });

  const endEmoji =
    name.length >= emojiLength ? name.substring(name.length - emojiLength) : "";
  const cleanName = (
    allFaces.has(endEmoji) ? name.substring(0, name.length - emojiLength) : name
  ).trimEnd();

  // TODO: Make sure this works in BST
  const now = new Date();
  const hour = now.getHours() % 12;
  const minute = now.getMinutes();

  const clockSet = clockFaces[hour];
  const clockFace = minute >= 30 ? clockSet.half : clockSet.hour;

  console.log(`Selected clock face ${clockFace} based on ${now.toISOString()}`);

  const fullName = `${cleanName} ${clockFace}`;

  console.log(`Updating name to "${fullName}"`);

  await api.send({
    method: "POST",
    url: "https://api.twitter.com/1.1/account/update_profile.json",
    params: {
      name: fullName,
    },
  });
}

export function setupCron() {
  const cron = new Cron();
  cron.add("0,30 * * * *", updateName);
  return cron;
}

if (import.meta.main) {
  await updateName();
  const cron = setupCron();
  cron.start();
  console.log("Started service...");
}
