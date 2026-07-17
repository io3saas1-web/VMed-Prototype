const DEFAULT_FEMET_BASE_URL =
  "https://rd-io3.femetmed.com/api-rtwatchm";

const DEFAULT_ALLOWED_EMAILS = [
  "admin@io3demo.com",
  "clinician@io3demo.com",
];

const ALLOWED_GROUP_NO = "VMedDemoGroup";
const ALLOWED_CARD_IDS = new Set([
  "CARD-001",
  "CARD-002",
  "CARD-003",
  "CARD-004",
  "CARD-005",
]);

let femetToken = null;
let femetRefreshToken = null;
let femetTokenExpiresAt = 0;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pickToken(body) {
  return (
    body?.data?.Token ??
    body?.data?.token ??
    body?.Token ??
    body?.token ??
    null
  );
}

function pickRefreshToken(body) {
  return (
    body?.data?.RefreshToken ??
    body?.data?.refreshToken ??
    body?.RefreshToken ??
    body?.refreshToken ??
    null
  );
}

function tokenExpiryMs(token) {
  try {
    const payloadSegment = token.split(".")[1];
    const normalized = payloadSegment
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8")
    );
    return Number(payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function configuredAllowedEmails() {
  const configured = process.env.VITALS_ALLOWED_EMAILS;
  if (!configured) return new Set(DEFAULT_ALLOWED_EMAILS);

  return new Set(
    configured
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function verifyFirebaseCaller(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Firebase sign-in is required."), {
      status: 401,
    });
  }

  const idToken = authorization.slice("Bearer ".length).trim();
  const apiKey =
    process.env.FIREBASE_WEB_API_KEY ||
    "AIzaSyDITCsiWG-syhmhblKPj0j9OTkYN5MdRbY";

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ idToken }),
    }
  );

  const body = await readBody(response);
  const user = body?.users?.[0];

  if (!response.ok || !user?.email) {
    throw Object.assign(new Error("Firebase session is invalid or expired."), {
      status: 401,
    });
  }

  const email = String(user.email).toLowerCase();
  if (!configuredAllowedEmails().has(email)) {
    throw Object.assign(
      new Error("This Firebase account is not allowed to access vitals."),
      { status: 403 }
    );
  }

  return { uid: user.localId, email };
}

async function loginToFemet() {
  const rawAccount = process.env.FEMET_ACCOUNT ?? "";
  const password = process.env.FEMET_PASSWORD ?? "";
  const account = rawAccount.trim();
  const baseUrl =
    process.env.FEMET_BASE_URL || DEFAULT_FEMET_BASE_URL;

  if (!account || !password) {
    throw new Error(
      "FEMET_ACCOUNT and FEMET_PASSWORD are not configured in Netlify."
    );
  }

  const response = await fetch(`${baseUrl}/api/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "VMed-Prototype-Netlify/1.0",
    },
    body: JSON.stringify({ account, password }),
  });

  const body = await readBody(response);
  const token = pickToken(body);

  if (!response.ok || !token) {
    // This deliberately logs only lengths and the FEMET error response.
    // It never logs the account or password values.
    console.error("FEMET_AUTH_DIAGNOSTIC", {
      status: response.status,
      statusText: response.statusText,
      responseBody: body,
      accountLength: account.length,
      passwordLength: password.length,
      accountHadOuterWhitespace: rawAccount !== account,
      passwordHasOuterWhitespace: password !== password.trim(),
      baseUrl,
    });

    throw new Error(
      `FEMET authentication failed (HTTP ${response.status}). ` +
      "Open the Netlify function log and find FEMET_AUTH_DIAGNOSTIC."
    );
  }

  femetToken = token;
  femetRefreshToken = pickRefreshToken(body);
  femetTokenExpiresAt = tokenExpiryMs(token);
}

async function refreshFemetSession() {
  const baseUrl =
    process.env.FEMET_BASE_URL || DEFAULT_FEMET_BASE_URL;

  if (!femetRefreshToken) {
    await loginToFemet();
    return;
  }

  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ refreshToken: femetRefreshToken }),
  });

  const body = await readBody(response);
  const token = pickToken(body);

  if (!response.ok || !token) {
    femetToken = null;
    femetRefreshToken = null;
    femetTokenExpiresAt = 0;
    await loginToFemet();
    return;
  }

  femetToken = token;
  femetRefreshToken = pickRefreshToken(body) || femetRefreshToken;
  femetTokenExpiresAt = tokenExpiryMs(token);
}

async function ensureFemetToken() {
  const safetyWindowMs = 60_000;

  if (
    femetToken &&
    (!femetTokenExpiresAt ||
      femetTokenExpiresAt > Date.now() + safetyWindowMs)
  ) {
    return;
  }

  if (femetRefreshToken) {
    await refreshFemetSession();
  } else {
    await loginToFemet();
  }
}

async function requestVitals({ groupNo, cardId, startTime, endTime }) {
  const baseUrl =
    process.env.FEMET_BASE_URL || DEFAULT_FEMET_BASE_URL;

  await ensureFemetToken();

  const upstreamUrl =
    `${baseUrl}/api/v2/vital_sign_record/` +
    `${encodeURIComponent(groupNo)}/period/${encodeURIComponent(cardId)}` +
    `?startTime=${encodeURIComponent(startTime)}` +
    `&endTime=${encodeURIComponent(endTime)}`;

  let response = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${femetToken}`,
    },
  });

  if (response.status === 401) {
    await refreshFemetSession();
    response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${femetToken}`,
      },
    });
  }

  const body = await readBody(response);

  return {
    status: response.status,
    body,
  };
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await verifyFirebaseCaller(request);

    const url = new URL(request.url);
    const groupNo = url.searchParams.get("groupNo") || "";
    const cardId = url.searchParams.get("cardId") || "";
    const startTime = url.searchParams.get("startTime") || "";
    const endTime = url.searchParams.get("endTime") || "";

    if (groupNo !== ALLOWED_GROUP_NO) {
      return json({ error: "Unsupported groupNo." }, 400);
    }

    if (!ALLOWED_CARD_IDS.has(cardId)) {
      return json({ error: "Unsupported cardId." }, 400);
    }

    if (!/^\d+$/.test(startTime) || !/^\d+$/.test(endTime)) {
      return json(
        { error: "startTime and endTime must be Unix epoch milliseconds." },
        400
      );
    }

    const result = await requestVitals({
      groupNo,
      cardId,
      startTime,
      endTime,
    });

    if (result.status < 200 || result.status >= 300) {
      return json(
        {
          error: "FEMET vitals request failed.",
          upstreamStatus: result.status,
          upstreamBody: result.body,
        },
        502
      );
    }

    return json(result.body, 200);
  } catch (error) {
    console.error(error);

    const status =
      Number.isInteger(error?.status) ? error.status : 500;

    return json(
      {
        error:
          status === 500
            ? "Server-side vitals service failed."
            : error.message,
      },
      status
    );
  }
};
