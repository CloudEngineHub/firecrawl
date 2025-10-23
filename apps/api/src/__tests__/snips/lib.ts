import { configDotenv } from "dotenv";
configDotenv();

import { TeamFlags } from "../../controllers/v1/types";

// =========================================
// Configuration
// =========================================

export const TEST_API_URL = process.env.TEST_API_URL || "http://127.0.0.1:3002";
export const TEST_URL = TEST_API_URL; // backwards compat temp

const stripTrailingSlash = (url: string) => {
  if (url.length < 1) throw new Error("Invalid URL supplied");
  return url.endsWith("/") ? url.substring(0, url.length - 1) : url;
};

export const TEST_SUITE_WEBSITE = stripTrailingSlash(
  process.env.TEST_SUITE_WEBSITE || "http://127.0.0.1:4321",
);

export const TEST_SELF_HOST = process.env.TEST_SUITE_SELF_HOSTED === "true";
export const TEST_PRODUCTION = !TEST_SELF_HOST;

// TODO: do we want to run AI tests when users run this command locally? It may lead to increased spending for them, depending on configuration
export const HAS_AI = !!(
  process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL
);
export const HAS_PLAYWRIGHT = !!process.env.PLAYWRIGHT_MICROSERVICE_URL;
export const HAS_PROXY = !!process.env.PROXY_SERVER;

export const HAS_SEARCH = TEST_PRODUCTION || !!process.env.SEARXNG_ENDPOINT;

const isLocalUrl = (x: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?([\/?#]|$)/i.test(
    x as string,
  );

// due to playwright / api using proxy, we don't want to run local tests while proxy is enabled or in production testing
export const ALLOW_TEST_SUITE_WEBSITE =
  !TEST_SELF_HOST || (isLocalUrl(TEST_SUITE_WEBSITE) && !HAS_PROXY);

// TODO: print the config that determines tests run

export const describeIf = (cond: boolean) => (cond ? describe : describe.skip);
export const concurrentIf = (cond: boolean) => (cond ? it.concurrent : it.skip);
export const testIf = (cond: boolean) => (cond ? test : test.skip);
export const itIf = (cond: boolean) => (cond ? it : it.skip);

export const createTestIdUrl = () =>
  `${TEST_SUITE_WEBSITE}?testId=${crypto.randomUUID()}`;

if (isLocalUrl(TEST_SUITE_WEBSITE)) {
  if (TEST_SELF_HOST) {
    process.env.ALLOW_LOCAL_WEBHOOKS = "true";
  } else {
    throw new Error(
      "TEST_SUITE_WEBSITE cannot be a local address while testing in production",
    );
  }
}

// Due to the limited resources of the CI runner, we need to set a longer timeout for the many many scrape tests
export const scrapeTimeout = 90000;
export const indexCooldown = 30000;

// =========================================
// idmux
// =========================================

export type IdmuxRequest = {
  name: string;

  concurrency?: number;
  credits?: number;
  tokens?: number;
  flags?: TeamFlags;
  teamId?: string;
};

export async function idmux(req: IdmuxRequest): Promise<Identity> {
  if (!process.env.IDMUX_URL) {
    if (TEST_PRODUCTION) {
      console.warn("IDMUX_URL is not set, using test API key and team ID");
    }
    return {
      apiKey: process.env.TEST_API_KEY!,
      teamId: process.env.TEST_TEAM_ID!,
    };
  }

  let runNumber = parseInt(process.env.GITHUB_RUN_NUMBER!);
  if (isNaN(runNumber) || runNumber === null || runNumber === undefined) {
    runNumber = 0;
  }

  const res = await fetch(process.env.IDMUX_URL + "/", {
    method: "POST",
    body: JSON.stringify({
      refName: process.env.GITHUB_REF_NAME!,
      runNumber,
      concurrency: req.concurrency ?? 100,
      ...req,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error(await res.text());
  }

  expect(res.ok).toBe(true);
  return await res.json();
}

export type Identity = {
  apiKey: string;
  teamId: string;
};
