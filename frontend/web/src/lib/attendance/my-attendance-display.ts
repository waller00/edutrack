export type MyAttendanceType = "CHECK_IN" | "CHECK_OUT";
export type MyAttendanceStatus =
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "ABSENT_NOT_JUSTIFIED"
  | "ABSENT_JUSTIFIED"
  | "SUBSTITUTED"
  | "EXIT"
  | "EARLY_EXIT"
  | "JUSTIFIED"
  | "FREE"
  | "PENDING_REVIEW"
  | "SUSPENDED"
  | "OUT_OF_SCHEDULE"
  | "UNIDENTIFIED_PUNCH"
  | "MEDICAL_LEAVE"
  | "JUSTIFIED_ABSENCE";

/** Mientras no se sabe el ciclo: el año calendario (ver `defaultMyAttendanceRange`). */
export function getDefaultAttendanceStartDate() {
  return `${new Date().getFullYear()}-01-01`;
}

/** Una salida no es una falta: va en neutro, no en el rojo de las faltas. */
export function getAttendanceTypeStyle(type: MyAttendanceType) {
  return type === "CHECK_IN" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-800";
}

const ABSENCE_STATUSES: ReadonlySet<MyAttendanceStatus> = new Set([
  "ABSENT",
  "ABSENT_NOT_JUSTIFIED",
  "ABSENT_JUSTIFIED",
  "SUBSTITUTED",
  "MEDICAL_LEAVE",
  "JUSTIFIED_ABSENCE",
]);

export function isAbsenceStatus(status: MyAttendanceStatus): boolean {
  return ABSENCE_STATUSES.has(status);
}

/**
 * Qué es el registro: entrada, salida, falta, o una ausencia que no es falta (licencia, o una clase
 * con suplente: no faltó, estaba previsto que no fuera).
 */
export function getAttendanceKindLabel(type: MyAttendanceType, status: MyAttendanceStatus) {
  if (status === "MEDICAL_LEAVE") return "Licencia";
  if (status === "SUBSTITUTED") return "Ausencia";
  return isAbsenceStatus(status) ? "Falta" : getAttendanceTypeLabel(type);
}

export function getAttendanceTypeLabel(type: MyAttendanceType) {
  return type === "CHECK_IN" ? "Entrada" : "Salida";
}

export function getAttendanceStatusStyle(status: MyAttendanceStatus) {
  switch (status) {
    case "PRESENT":
    case "EXIT":
      return "bg-green-100 text-green-800";
    case "LATE":
    case "EARLY_EXIT":
      return "bg-yellow-100 text-yellow-800";
    case "MEDICAL_LEAVE":
    case "ABSENT_JUSTIFIED":
    case "JUSTIFIED":
      return "bg-blue-100 text-blue-800";
    case "ABSENT_NOT_JUSTIFIED":
      return "bg-red-100 text-red-800";
    case "SUBSTITUTED":
      return "bg-amber-100 text-amber-900";
    case "FREE":
    case "SUSPENDED":
    case "OUT_OF_SCHEDULE":
    case "UNIDENTIFIED_PUNCH":
    case "PENDING_REVIEW":
      return "bg-slate-100 text-slate-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function getAttendanceStatusLabel(status: MyAttendanceStatus) {
  switch (status) {
    case "PRESENT":
      return "Presente";
    case "LATE":
      return "Tarde";
    case "EXIT":
      return "Salida";
    case "EARLY_EXIT":
      return "Salida anticipada";
    case "MEDICAL_LEAVE":
      return "Licencia Médica";
    case "JUSTIFIED_ABSENCE":
    case "ABSENT_JUSTIFIED":
      return "Ausencia Justificada";
    case "ABSENT_NOT_JUSTIFIED":
      return "Ausencia sin justificar";
    case "SUBSTITUTED":
      return "Ausencia con suplente";
    case "JUSTIFIED":
      return "Justificado";
    case "FREE":
      return "Libre";
    case "PENDING_REVIEW":
      return "Pendiente de revisión";
    case "SUSPENDED":
      return "Suspendido";
    case "OUT_OF_SCHEDULE":
      return "Fuera de horario";
    case "UNIDENTIFIED_PUNCH":
      return "Marcación no identificada";
    default:
      return "Ausente";
  }
}

export function getAttendanceStatusLabelForType(type: MyAttendanceType, status: MyAttendanceStatus) {
  if (
    type === "CHECK_OUT" &&
    (status === "ABSENT" ||
      status === "ABSENT_NOT_JUSTIFIED" ||
      status === "ABSENT_JUSTIFIED" ||
      status === "SUBSTITUTED" ||
      status === "MEDICAL_LEAVE" ||
      status === "JUSTIFIED_ABSENCE")
  ) {
    return "Salida pendiente";
  }
  return getAttendanceStatusLabel(status);
}
