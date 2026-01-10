"use server";

import { ID, Query } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import { Patient } from "@/types/appwrite.types";

import {
  BUCKET_ID,
  DATABASE_ID,
  PATIENT_COLLECTION_ID,
  storage,
  tablesDB,
  users,
} from "../appwrite.config";
import { parseStringify } from "../utils";

const getErrorCode = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const maybe = error as Record<string, unknown>;
  return typeof maybe.code === "number" ? maybe.code : undefined;
};

const getErrorMessage = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const maybe = error as Record<string, unknown>;
  return typeof maybe.message === "string" ? maybe.message : undefined;
};

// CREATE APPWRITE USER
export const createUser = async (user: CreateUserParams) => {
  try {
    // Create new user -> https://appwrite.io/docs/references/1.5.x/server-nodejs/users#create
    const newuser = await users.create(
      ID.unique(),
      user.email,
      user.phone,
      undefined,
      user.name
    );

    return parseStringify(newuser);
  } catch (error: unknown) {
    // Check existing user
    if (getErrorCode(error) === 409) {
      const existingUser = await users.list([
        Query.equal("email", [user.email]),
      ]);

      return existingUser.users[0];
    }
    console.error("An error occurred while creating a new user:", error);
  }
};

// GET USER
export const getUser = async (userId: string) => {
  try {
    const user = await users.get(userId);

    return parseStringify(user) as User;
  } catch (error) {
    console.error(
      "An error occurred while retrieving the user details:",
      error
    );
    return null;
  }
};

// REGISTER PATIENT
export const registerPatient = async ({
  identificationDocument,
  userId,
  ...patient
}: RegisterUserParams) => {
  try {
    // Upload file ->  // https://appwrite.io/docs/references/cloud/client-web/storage#createFile
    let file;
    if (identificationDocument) {
      const inputFile =
        identificationDocument &&
        InputFile.fromBuffer(
          identificationDocument?.get("blobFile") as Blob,
          identificationDocument?.get("fileName") as string
        );

      file = await storage.createFile(BUCKET_ID!, ID.unique(), inputFile);
    }

    // Create new patient document -> https://appwrite.io/docs/references/cloud/server-nodejs/databases#createDocument
    const patientData: Record<string, unknown> = {
      // Appwrite collection schema expects `userID` (capital D) in some setups.
      userID: userId,
      ...patient,
    };

    // Appwrite enums are often configured as lowercase (e.g. "male", "female", "other").
    // Normalize the submitted value without forcing the UI to change.
    if (typeof patientData.gender === "string") {
      patientData.gender = patientData.gender.toLowerCase();
    }

    // Some Appwrite schemas constrain `identificationDocumentUrl` to short strings (e.g. <= 100 chars).
    // Store the file id (short + stable) and derive the full view URL when needed.
    if (file?.$id) {
      patientData.identificationDocumentId = file.$id;
      patientData.identificationDocumentUrl = file.$id;
    }

    const newPatient = await tablesDB.createRow({
      databaseId: DATABASE_ID!,
      tableId: PATIENT_COLLECTION_ID!,
      rowId: userId,
      data: patientData,
    });

    return parseStringify(newPatient);
  } catch (error) {
    console.error("An error occurred while creating a new patient:", error);
  }
};

// GET PATIENT
export const getPatient = async (userId: string) => {
  try {
    // Prefer fetching by document ID (we create patient docs with id=userId).
    const patient = await tablesDB.getRow<Patient>({
      databaseId: DATABASE_ID!,
      tableId: PATIENT_COLLECTION_ID!,
      rowId: userId,
    });

    return parseStringify(patient);
  } catch (error: unknown) {
    // Backward compatibility: if the project previously used random document IDs,
    // try querying by a `userId` attribute (if present in the collection schema).
    if (getErrorCode(error) === 404) {
      try {
        const patients = await tablesDB.listRows<Patient>({
          databaseId: DATABASE_ID!,
          tableId: PATIENT_COLLECTION_ID!,
          queries: [Query.equal("userID", [userId])],
        });

        const doc = patients.rows[0];
        return doc ? parseStringify(doc) : null;
      } catch (queryError: unknown) {
        const msg = getErrorMessage(queryError) ?? "";
        if (
          getErrorCode(queryError) === 400 &&
          (msg.includes("Attribute not found in schema: userID") ||
            msg.includes("Attribute not found in schema: userId"))
        ) {
          return null;
        }
        console.error(
          "An error occurred while retrieving the patient details:",
          queryError
        );
        return null;
      }
    }
    console.error(
      "An error occurred while retrieving the patient details:",
      error
    );
    return null;
  }
};
