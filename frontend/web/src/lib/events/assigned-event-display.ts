export function getEventTypeLabel(type: string) {
  switch (type) {
    case "CLASE":
      return "Clase";
    case "REUNION":
      return "Reunión";
    case "JORNADA_LABORAL":
      return "Jornada laboral";
    case "EVENTO":
      return "Evento";
    case "CAPACITACION":
      return "Capacitación";
    case "CITA_MEDICA":
      return "Cita médica";
    default:
      return type;
  }
}

export function getAssignedEventStatusLabel(status: string) {
  switch (status) {
    case "SCHEDULED":
      return "Programado";
    case "IN_PROGRESS":
      return "En curso";
    case "COMPLETED":
      return "Completado";
    case "CANCELLED":
      return "Cancelado";
    default:
      return status;
  }
}

export function getAssignedEventStatusColor(status: string) {
  switch (status) {
    case "SCHEDULED":
      return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS":
      return "bg-yellow-100 text-yellow-800";
    case "COMPLETED":
      return "bg-green-100 text-green-800";
    case "CANCELLED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function getDaysOfWeekLabel(daysOfWeek: number[]) {
  if (!daysOfWeek?.length) return "";
  return daysOfWeek.map((day) => DAY_NAMES[day]).join(", ");
}
