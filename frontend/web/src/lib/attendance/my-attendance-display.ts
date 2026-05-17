export type MyAttendanceType = "CHECK_IN" | "CHECK_OUT";
export type MyAttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "MEDICAL_LEAVE"
  | "JUSTIFIED_ABSENCE";

export function getDefaultAttendanceStartDate() {
  return `${new Date().getFullYear()}-01-01`;
}

export function getAttendanceTypeStyle(type: MyAttendanceType) {
  return type === "CHECK_IN" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
}

export function getAttendanceTypeLabel(type: MyAttendanceType) {
  return type === "CHECK_IN" ? "Entrada" : "Salida";
}

export function getAttendanceStatusStyle(status: MyAttendanceStatus) {
  switch (status) {
    case "PRESENT":
      return "bg-green-100 text-green-800";
    case "LATE":
      return "bg-yellow-100 text-yellow-800";
    case "MEDICAL_LEAVE":
      return "bg-blue-100 text-blue-800";
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
    case "MEDICAL_LEAVE":
      return "Licencia Médica";
    case "JUSTIFIED_ABSENCE":
      return "Ausencia Justificada";
    default:
      return "Ausente";
  }
}
