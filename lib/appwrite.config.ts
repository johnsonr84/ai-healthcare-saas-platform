import * as sdk from "node-appwrite";

export const {
  NEXT_PUBLIC_ENDPOINT: ENDPOINT,
  PROJECT_ID,
  API_KEY,
  DATABASE_ID,
  PATIENT_COLLECTION_ID,
  DOCTOR_COLLECTION_ID,
  APPOINTMENT_COLLECTION_ID,
  NEXT_PUBLIC_BUCKET_ID: BUCKET_ID,
} = process.env;

function assertEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[Appwrite] Missing environment variable: ${name}. ` +
      `Create a .env.local with ${name} and restart the dev server.`
    );
  }
  return value;
}

function validateEndpoint(endpoint: string): string {
  if (endpoint.includes("sanfransico.cloud.appwrite.io")) {
    throw new Error(
      `[Appwrite] Invalid ENDPOINT hostname: "sanfransico.cloud.appwrite.io" (typo). ` +
      `Did you mean "sanfrancisco.cloud.appwrite.io"? ` +
      `Alternatively use "https://cloud.appwrite.io/v1".`
    );
  }

  try {
    const url = new URL(endpoint);
    if (!url.protocol.startsWith("http")) {
      throw new Error("Endpoint must start with http/https.");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      `[Appwrite] Invalid NEXT_PUBLIC_ENDPOINT value: "${endpoint}". ` +
      `Expected a URL like "https://cloud.appwrite.io/v1" or ` +
      `"https://sanfrancisco.cloud.appwrite.io/v1".`
    );
  }
}

const client = new sdk.Client();

const resolvedEndpoint = validateEndpoint(
  assertEnv("NEXT_PUBLIC_ENDPOINT", ENDPOINT)
);

client
  .setEndpoint(resolvedEndpoint)
  .setProject(assertEnv("PROJECT_ID", PROJECT_ID))
  .setKey(assertEnv("API_KEY", API_KEY));

export const databases = new sdk.Databases(client);
export const tablesDB = new sdk.TablesDB(client);
export const users = new sdk.Users(client);
export const messaging = new sdk.Messaging(client);
export const storage = new sdk.Storage(client);
