"use server";

import { revalidatePath } from "next/cache";
import { ID, Query } from "node-appwrite";

import { Appointment, Patient } from "@/types/appwrite.types";

import {
  APPOINTMENT_COLLECTION_ID,
  DATABASE_ID,
  messaging,
  PATIENT_COLLECTION_ID,
  tablesDB,
} from "../appwrite.config";
import { formatDateTime, parseStringify } from "../utils";

const getErrorMessage = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const maybe = error as Record<string, unknown>;
  return typeof maybe.message === "string" ? maybe.message : undefined;
};

const getPatientIdFromAppointment = (appointment: Appointment): string | null => {
  const p = appointment.patient;
  if (typeof p === "string") return p;
  if (typeof p === "object" && p !== null && typeof p.$id === "string") {
    return p.$id;
  }
  return null;
};

//  CREATE APPOINTMENT
export const createAppointment = async (
  appointment: CreateAppointmentParams
) => {
  try {
    const appointmentId = ID.unique();
    const appointmentData: Record<string, unknown> = {
      ...appointment,
    };

    // Some Appwrite schemas require a separate `patientId` attribute.
    // Our form sends `patient` as the patient document id, so mirror it.
    if (typeof appointmentData.patient === "string") {
      appointmentData.patientId = appointmentData.patient;
    }

    const createRowOnce = async (data: Record<string, unknown>) =>
      await tablesDB.createRow({
        databaseId: DATABASE_ID!,
        tableId: APPOINTMENT_COLLECTION_ID!,
        rowId: appointmentId,
        data,
      });

    let newAppointment;
    try {
      newAppointment = await createRowOnce(appointmentData);
    } catch (error: unknown) {
      // If the table schema doesn't include our compatibility fields (e.g. `patientId`),
      // Appwrite returns "Unknown attribute". Retry once without the unknown field.
      const message = getErrorMessage(error);

      const match =
        typeof message === "string"
          ? message.match(/Unknown attribute:\s+"([^"]+)"/)
          : null;

      if (match?.[1]) {
        const retryData = { ...appointmentData };
        delete retryData[match[1]];
        newAppointment = await createRowOnce(retryData);
      } else {
        throw error;
      }
    }

    revalidatePath("/admin");
    return parseStringify(newAppointment);
  } catch (error) {
    console.error("An error occurred while creating a new appointment:", error);
  }
};

//  GET RECENT APPOINTMENTS
export const getRecentAppointmentList = async () => {
  try {
    const appointments = await tablesDB.listRows<Appointment>({
      databaseId: DATABASE_ID!,
      tableId: APPOINTMENT_COLLECTION_ID!,
      queries: [Query.orderDesc("$createdAt")],
    });

    const patientIds = Array.from(
      new Set(
        appointments.rows
          .map(getPatientIdFromAppointment)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );

    const patients =
      patientIds.length > 0
        ? await tablesDB.listRows<Patient>({
            databaseId: DATABASE_ID!,
            tableId: PATIENT_COLLECTION_ID!,
            queries: [Query.equal("$id", patientIds)],
          })
        : { total: 0, rows: [] as Patient[] };

    const patientById = new Map(patients.rows.map((p) => [p.$id, p]));

    const hydratedAppointments = appointments.rows.map((a) => {
      const patientId = getPatientIdFromAppointment(a);
      const hydratedPatient = patientId
        ? patientById.get(patientId) ?? a.patient
        : a.patient;

      return { ...a, patient: hydratedPatient };
    });

    // const scheduledAppointments = (
    //   appointments.documents as Appointment[]
    // ).filter((appointment) => appointment.status === "scheduled");

    // const pendingAppointments = (
    //   appointments.documents as Appointment[]
    // ).filter((appointment) => appointment.status === "pending");

    // const cancelledAppointments = (
    //   appointments.documents as Appointment[]
    // ).filter((appointment) => appointment.status === "cancelled");

    // const data = {
    //   totalCount: appointments.total,
    //   scheduledCount: scheduledAppointments.length,
    //   pendingCount: pendingAppointments.length,
    //   cancelledCount: cancelledAppointments.length,
    //   documents: appointments.documents,
    // };

    const initialCounts = {
      scheduledCount: 0,
      pendingCount: 0,
      cancelledCount: 0,
    };

    const counts = appointments.rows.reduce(
      (acc, appointment) => {
        switch (appointment.status) {
          case "scheduled":
            acc.scheduledCount++;
            break;
          case "pending":
            acc.pendingCount++;
            break;
          case "cancelled":
            acc.cancelledCount++;
            break;
        }
        return acc;
      },
      initialCounts
    );

    const data = {
      totalCount: appointments.total,
      ...counts,
      documents: hydratedAppointments,
    };

    return parseStringify(data);
  } catch (error) {
    console.error(
      "An error occurred while retrieving the recent appointments:",
      error
    );
  }
};

//  SEND SMS NOTIFICATION
export const sendSMSNotification = async (userId: string, content: string) => {
  try {
    // https://appwrite.io/docs/references/1.5.x/server-nodejs/messaging#createSms
    const message = await messaging.createSms(
      ID.unique(),
      content,
      [],
      [userId]
    );
    return parseStringify(message);
  } catch (error) {
    console.error("An error occurred while sending sms:", error);
  }
};

//  UPDATE APPOINTMENT
export const updateAppointment = async ({
  appointmentId,
  userId,
  timeZone,
  appointment,
  type,
}: UpdateAppointmentParams) => {
  try {
    // Update appointment to scheduled -> https://appwrite.io/docs/references/cloud/server-nodejs/databases#updateDocument
    const updatedAppointment = await tablesDB.updateRow({
      databaseId: DATABASE_ID!,
      tableId: APPOINTMENT_COLLECTION_ID!,
      rowId: appointmentId,
      data: appointment,
    });

    if (!updatedAppointment) throw Error;

    const smsMessage = `Greetings from Salus Health Management System. ${type === "schedule" ? `Your appointment is confirmed for ${formatDateTime(appointment.schedule!, timeZone).dateTime} with Dr. ${appointment.primaryPhysician}` : `We regret to inform that your appointment for ${formatDateTime(appointment.schedule!, timeZone).dateTime} is cancelled. Reason:  ${appointment.cancellationReason}`}.`;
    await sendSMSNotification(userId, smsMessage);

    revalidatePath("/admin");
    return parseStringify(updatedAppointment);
  } catch (error) {
    console.error("An error occurred while scheduling an appointment:", error);
  }
};

// GET APPOINTMENT
export const getAppointment = async (appointmentId: string) => {
  try {
    const appointment = await tablesDB.getRow<Appointment>({
      databaseId: DATABASE_ID!,
      tableId: APPOINTMENT_COLLECTION_ID!,
      rowId: appointmentId,
    });

    return parseStringify(appointment);
  } catch (error) {
    console.error(
      "An error occurred while retrieving the existing patient:",
      error
    );
    return null;
  }
};
