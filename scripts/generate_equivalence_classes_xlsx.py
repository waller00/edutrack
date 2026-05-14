#!/usr/bin/env python3
from __future__ import annotations

import html
import os
import zipfile
from dataclasses import dataclass
from typing import Iterable


OUTPUT = os.path.join("docs", "Clases_de_Equivalencia_EduTrack.xlsx")


@dataclass(frozen=True)
class Field:
    name: str
    required: str
    restrictions: str
    valid_data: str
    valid_examples: str
    invalid_data: str
    invalid_examples: str


@dataclass(frozen=True)
class Module:
    title: str
    fields: list[Field]


HEADERS = [
    "Campo",
    "Obligatorio",
    "Restricciones",
    "Datos Validos",
    "Ejemplos Validos",
    "Datos Invalidos",
    "Ejemplos Invalidos",
]


MODULES = [
    Module(
        "Modulo Autenticacion y Registro",
        [
            Field("Email", "1", "Formato email valido; unico; sin espacios", "Texto con @ y dominio", "ana@edutrack.uy", "Email sin @, sin dominio o repetido", "ana.edutrack.uy\nana@\nemail ya registrado"),
            Field("Contrasena", "1", "Minimo 8 y maximo 64 caracteres; debe incluir mayuscula, minuscula y numero", "Alfanumericos y simbolos", "EduTrack2026", "Muy corta o sin variedad de caracteres", "password\nEDUTRACK\n12345678"),
            Field("Confirmacion de contrasena", "1", "Debe coincidir exactamente con la contrasena", "Mismo texto que contrasena", "EduTrack2026", "Valor diferente", "EduTrack2025"),
            Field("Usuario", "1", "Entre 3 y 30 caracteres; letras, numeros, punto, guion y guion bajo; unico", "Alfanumericos . _ -", "juan.perez_1", "Menos de 3, caracteres no permitidos o repetido", "jp\njuan*2026\nusuario existente"),
            Field("Nombre", "1", "Entre 1 y 80 caracteres", "Texto alfabetico", "Juan", "Campo vacio o mayor a 80 caracteres", "NULL\n(nombre de 81 caracteres)"),
            Field("Apellido", "1", "Entre 1 y 80 caracteres", "Texto alfabetico", "Perez", "Campo vacio o mayor a 80 caracteres", "NULL\n(apellido de 81 caracteres)"),
            Field("Cedula", "1", "Cedula uruguaya valida; 7 u 8 digitos; unica", "Digitos con digito verificador valido", "1.234.567-2", "Cedula invalida o repetida", "1234567\nabcdef\ncedula ya usada"),
            Field("Celular", "0", "Si se informa: 9 digitos; empieza con 09; no puede ser una cedula", "Numero movil local UY", "094481122", "Formato incorrecto o igual a cedula", "12345678\n09999\n+598094481122"),
            Field("Fecha de nacimiento", "1", "No puede ser futura; edad minima 5 anos", "Fecha ISO o calendario", "2010-05-10", "Fecha futura o menor a edad minima", "2030-01-01\n2024-12-01"),
            Field("Perfil", "1", "Debe seleccionarse un rol activo permitido para registro", "STAFF o TEACHER", "TEACHER", "Rol vacio o no permitido", "NULL\nADMIN\nESTUDIANTE"),
            Field("Verificacion de identidad", "1", "Debe completarse por Didit cuando esta configurado", "Sesion aprobada y vigente", "APPROVED", "Sesion pendiente, vencida o rechazada", "PENDING\nDECLINED\nEXPIRED"),
            Field("Vencimiento del DNI", "1", "Se captura por verificacion; fecha valida; documento no vencido", "Fecha entre 1950 y 2100", "2032-08-15", "Fecha invalida o documento vencido", "1940-01-01\nayer\nNULL"),
        ],
    ),
    Module(
        "Modulo Gestion de Usuarios",
        [
            Field("Email", "1", "Formato email valido; unico", "Email valido", "docente@institucion.uy", "Email invalido o repetido", "docente\ncorreo ya usado"),
            Field("Perfil/Rol", "1", "Rol activo existente; no se puede promover a ADMIN desde la pantalla", "Codigo de rol activo", "STAFF\nTEACHER", "Rol inexistente, inactivo o ADMIN no permitido", "ADMIN\nROL_INEXISTENTE"),
            Field("Usuario", "0", "Entre 3 y 30 caracteres; unico", "Letras, numeros, punto, guion y guion bajo", "maria.rodriguez", "Corto, caracter invalido o duplicado", "mr\nmaria*"),
            Field("Nombre", "0", "Si se informa: 1 a 80 caracteres", "Texto", "Maria", "Mayor a 80 caracteres", "(nombre de 81 caracteres)"),
            Field("Apellido", "0", "Si se informa: 1 a 80 caracteres", "Texto", "Rodriguez", "Mayor a 80 caracteres", "(apellido de 81 caracteres)"),
            Field("Cedula", "0", "Si se informa: cedula uruguaya valida y unica", "7 u 8 digitos validos", "4.567.890-1", "Cedula invalida o asignada a otro usuario", "11111111\ncedula repetida"),
            Field("Vencimiento de documento", "0", "Fecha valida o vacio para quitar el dato", "Fecha ISO", "2030-03-20", "Fecha fuera de rango o invalida", "1900-01-01\ntexto"),
            Field("Aprobado", "0", "Booleano; ADMIN no puede quedar pendiente", "true / false", "true", "Texto u operacion prohibida para ADMIN", "si\nfalse para ADMIN"),
            Field("Activo", "0", "Booleano; ADMIN no puede darse de baja desde esta pantalla", "true / false", "true", "Texto u operacion prohibida para ADMIN", "no\nfalse para ADMIN"),
            Field("Bloqueo de cuenta", "0", "Parametro lock=true/false; aplica por 15 minutos", "Booleano en query", "lock=true", "Usuario inexistente o bloqueo de ADMIN", "lock=talvez\nADMIN bloqueado"),
        ],
    ),
    Module(
        "Modulo Gestion de Perfiles y Permisos",
        [
            Field("Codigo de rol", "1", "Entre 2 y 48 caracteres; mayusculas, numeros y _; empieza con letra; unico", "Codigo normalizado", "COORDINADOR", "Codigo repetido o con caracteres invalidos", "1ROL\nROL-UNO\nADMIN existente"),
            Field("Nombre del perfil", "1", "Entre 2 y 80 caracteres", "Texto", "Coordinador academico", "Vacio o menor a 2 caracteres", "A\nNULL"),
            Field("Estado", "0", "Booleano; roles del sistema no se pueden desactivar", "Activo/Inactivo", "Activo", "Valor no booleano o baja de rol built-in", "talvez\nInactivo para ADMIN"),
            Field("Permiso", "1", "Debe existir en catalogo o crearse con modulo y accion validos", "Codigo de permiso", "events.read", "Permiso inexistente o duplicado para el rol", "eventos leer\npermiso repetido"),
            Field("Modulo del permiso", "1", "Entre 2 y 50 caracteres", "Texto identificador", "events", "Menor a 2 o mayor a 50 caracteres", "e\n(modulo de 51 caracteres)"),
            Field("Accion del permiso", "1", "Entre 2 y 30 caracteres", "Texto identificador", "read", "Menor a 2 o mayor a 30 caracteres", "r\n(accion de 31 caracteres)"),
            Field("Etiqueta del permiso", "1", "Entre 2 y 80 caracteres", "Texto visible", "Ver eventos", "Vacio o demasiado largo", "A\n(etiqueta de 81 caracteres)"),
            Field("Habilitado", "1", "Booleano", "true / false", "true", "Texto libre", "habilitado"),
            Field("Alcance", "0", "Solo valores own o all", "own / all", "all", "Valor fuera de lista", "todos\nnone"),
        ],
    ),
    Module(
        "Modulo Gestion de Eventos",
        [
            Field("Titulo", "1", "Entre 1 y 200 caracteres", "Texto", "Clase de Matematica", "Vacio o mayor a 200 caracteres", "NULL\n(titulo de 201 caracteres)"),
            Field("Descripcion", "0", "Texto opcional", "Texto", "Unidad 3", "Valor no textual", "123 como objeto"),
            Field("Tipo", "1", "Debe pertenecer al catalogo de tipos", "JORNADA_LABORAL, REUNION, CLASE, EVENTO, CAPACITACION, CITA_MEDICA", "CLASE", "Tipo inexistente", "EXAMEN"),
            Field("Fecha de inicio", "1", "YYYY-MM-DD o ISO; se interpreta en America/Montevideo", "Fecha valida", "2026-05-20", "Fecha vacia o invalida", "20/05/2026\nNULL"),
            Field("Hora inicio", "1", "Formato HH:MM o ISO", "Hora valida", "08:00", "Hora invalida", "25:00\ntexto"),
            Field("Hora fin", "1", "Debe ser mayor a la hora inicio", "Hora valida posterior", "09:30", "Menor o igual a inicio", "07:50\n08:00"),
            Field("Usuario asignado", "0", "UUID de usuario; TEACHER solo puede asignarse a si mismo", "UUID existente", "550e8400-e29b-41d4-a716-446655440000", "UUID invalido o usuario no permitido", "123\notro docente"),
            Field("Curso", "0", "UUID de curso activo", "Curso activo existente", "Curso 1A", "Curso inexistente o inactivo", "UUID inactivo"),
            Field("Repetitivo", "0", "Booleano", "true / false", "true", "Valor no booleano", "si"),
            Field("Tipo de recurrencia", "0", "NONE, DAILY, WEEKLY o MONTHLY; requerido si es repetitivo", "Valor del catalogo", "WEEKLY", "Valor fuera de catalogo", "YEARLY"),
            Field("Fin de recurrencia", "0", "Requerido si es repetitivo; debe ser >= fecha inicio", "Fecha valida", "2026-06-30", "Fecha anterior a inicio o invalida", "2026-04-01\ntexto"),
            Field("Dias de la semana", "0", "Arreglo de enteros 0 a 6; semanal requiere al menos un dia", "0=domingo a 6=sabado", "1,3,5", "Valores fuera de rango", "7\nlunes"),
            Field("Estado", "0", "SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED o EXPIRED", "Valor del catalogo", "SCHEDULED", "Estado inexistente", "PAUSED"),
            Field("Motivo de cancelacion", "0", "Texto requerido al cancelar segun flujo", "Texto", "Docente ausente", "Vacio cuando se exige motivo", "NULL"),
        ],
    ),
    Module(
        "Modulo Gestion de Asistencias",
        [
            Field("Tipo de marca", "1", "CHECK_IN o CHECK_OUT", "Valor del catalogo", "CHECK_IN", "Valor fuera de catalogo", "ENTRADA"),
            Field("Fecha", "1", "Datetime ISO", "Fecha/hora valida", "2026-05-20T08:00:00.000Z", "Formato invalido", "20/05/2026"),
            Field("Hora", "1", "Datetime ISO", "Fecha/hora valida", "2026-05-20T08:05:00.000Z", "Formato invalido", "08:05"),
            Field("Evento", "1", "UUID de evento existente; el usuario debe estar asignado", "Evento asignado al usuario", "Clase de Matematica", "Evento inexistente o no asignado", "UUID invalido\nevento de otro usuario"),
            Field("Notas", "0", "Texto opcional", "Texto", "Entrada manual", "Valor no textual", "objeto JSON"),
            Field("Estado", "0", "PRESENT, LATE, ABSENT_NOT_JUSTIFIED, ABSENT_JUSTIFIED, EXIT o EARLY_EXIT", "Valor del catalogo", "LATE", "Estado inexistente", "PENDIENTE"),
            Field("Filtro usuario", "0", "UUID de usuario para listados admin", "UUID existente", "550e8400-e29b-41d4-a716-446655440000", "UUID invalido", "usuario1"),
            Field("Filtro tipo de evento", "0", "Tipo de evento valido", "CLASE, REUNION, etc.", "CLASE", "Tipo fuera de catalogo", "EXAMEN"),
            Field("Paginacion", "0", "page numerico; pageSize maximo 100 en listados", "Enteros positivos", "page=1&pageSize=20", "Texto o tamano excesivo", "page=uno&pageSize=9999"),
        ],
    ),
    Module(
        "Modulo Incidentes de Asistencia",
        [
            Field("Tipo", "0", "LATE_ARRIVAL, TEACHER_NO_SHOW o EARLY_EXIT", "Valor del catalogo", "TEACHER_NO_SHOW", "Tipo inexistente", "AUSENCIA"),
            Field("Estado", "0", "OPEN, ACKNOWLEDGED o RESOLVED", "Valor del catalogo", "OPEN", "Estado inexistente", "CLOSED"),
            Field("Titulo", "1", "Texto generado o registrado por el sistema", "Texto", "Docente sin marca de entrada", "Vacio", "NULL"),
            Field("Descripcion", "0", "Texto opcional", "Texto", "No hubo check-in dentro de tolerancia", "Valor no textual", "objeto JSON"),
            Field("Severidad", "0", "Texto; por defecto HIGH", "LOW, MEDIUM, HIGH u otro valor definido", "HIGH", "Vacio si se requiere reportar alerta", "NULL"),
            Field("Usuario", "1", "UUID de usuario relacionado", "Usuario existente", "Docente asignado", "Usuario inexistente", "UUID inexistente"),
            Field("Evento", "0", "UUID de evento relacionado", "Evento existente", "Clase de Historia", "Evento inexistente", "UUID inexistente"),
        ],
    ),
    Module(
        "Modulo Gestion de Licencias",
        [
            Field("Usuario", "1", "UUID de usuario existente", "Usuario STAFF o TEACHER", "550e8400-e29b-41d4-a716-446655440000", "UUID invalido o usuario inexistente", "usuario1"),
            Field("Tipo", "1", "MEDICAL_LEAVE, WORK_LEAVE u OTHER", "Valor del catalogo", "MEDICAL_LEAVE", "Tipo fuera de catalogo", "VACACIONES"),
            Field("Fecha inicio", "1", "Datetime ISO", "Fecha/hora valida", "2026-05-01T00:00:00.000Z", "Formato invalido", "01/05/2026"),
            Field("Fecha fin", "1", "Datetime ISO; debe cubrir rango valido de licencia", "Fecha/hora valida", "2026-05-10T23:59:59.000Z", "Formato invalido o anterior a inicio", "texto\n2026-04-01"),
            Field("Motivo", "1", "Entre 1 y 500 caracteres", "Texto", "Reposo medico", "Vacio o mayor a 500 caracteres", "NULL\n(motivo de 501 caracteres)"),
            Field("Medico", "0", "Hasta 500 caracteres", "Texto", "Dra. Perez", "Mayor a 500 caracteres", "(texto de 501 caracteres)"),
            Field("Telefono medico", "0", "Hasta 80 caracteres", "Texto/numeros", "099123456", "Mayor a 80 caracteres", "(telefono de 81 caracteres)"),
            Field("Certificado", "0", "URL o referencia valida; largo maximo definido por sistema", "Texto de certificado", "https://archivo/certificado.pdf", "Texto demasiado largo o formato no aceptado", "(certificado demasiado largo)"),
            Field("Notas", "0", "Hasta 5000 caracteres", "Texto", "Aprobado por administracion", "Mayor a 5000 caracteres", "(nota de 5001 caracteres)"),
            Field("Estado", "0", "ACTIVE o INACTIVE", "Valor del catalogo", "ACTIVE", "Estado inexistente", "PENDING"),
        ],
    ),
    Module(
        "Modulo Cursos",
        [
            Field("Nombre", "1", "Entre 1 y 200 caracteres", "Texto", "1A Matutino", "Vacio o mayor a 200 caracteres", "NULL\n(nombre de 201 caracteres)"),
            Field("Codigo", "0", "Hasta 64 caracteres; unico cuando se informa", "Texto corto", "1A-2026", "Codigo duplicado o mayor a 64 caracteres", "codigo existente\n(codigo de 65 caracteres)"),
            Field("Descripcion", "0", "Hasta 2000 caracteres", "Texto", "Grupo de primer ano", "Mayor a 2000 caracteres", "(descripcion de 2001 caracteres)"),
            Field("Activo", "0", "Booleano; por defecto true", "true / false", "true", "Texto libre", "activo"),
        ],
    ),
    Module(
        "Modulo Configuracion del Sistema",
        [
            Field("Verificacion Didit activa", "0", "Booleano", "true / false", "true", "Valor no booleano", "si"),
            Field("Gracia de inasistencia", "0", "Entero entre 1 y 180 minutos", "Numero entero", "15", "Fuera de rango o decimal", "0\n181\n5.5"),
            Field("Tolerancia de llegada tarde", "0", "Entero entre 0 y 120 minutos", "Numero entero", "5", "Fuera de rango o decimal", "-1\n121\n3.5"),
            Field("Puente entre clases", "0", "Entero entre 15 y 240 minutos", "Numero entero", "60", "Fuera de rango", "10\n241"),
            Field("Monitor de asistencia", "0", "Booleano", "true / false", "true", "Valor no booleano", "encendido"),
            Field("Intervalo del monitor", "0", "Entero entre 30000 y 3600000 milisegundos", "Numero entero", "120000", "Fuera de rango", "10000\n4000000"),
            Field("Hora de tardanza biometrica", "0", "Entero entre 0 y 23", "Numero entero", "8", "Fuera de rango", "-1\n24"),
            Field("Minuto de tardanza biometrica", "0", "Entero entre 0 y 59", "Numero entero", "30", "Fuera de rango", "-1\n60"),
        ],
    ),
    Module(
        "Modulo Biometrico ADMS",
        [
            Field("Codigo de dispositivo", "1", "Entre 2 y 100 caracteres; dispositivo activo", "Texto", "ADM-PORTERIA", "Vacio, demasiado largo o dispositivo inexistente", "A\n(dispositivo de 101 caracteres)"),
            Field("Usuario del dispositivo", "1", "Entre 1 y 100 caracteres; mapeo activo si existe", "Texto o numero externo", "1024", "Vacio o demasiado largo", "NULL\n(valor de 101 caracteres)"),
            Field("Timestamp", "1", "Datetime ISO", "Fecha/hora valida", "2026-05-20T11:30:00.000Z", "Formato invalido", "20/05/2026 11:30"),
            Field("ID externo", "0", "Entre 1 y 150 caracteres; unico por dispositivo si se informa", "Texto", "punch-987", "Duplicado o mayor a 150 caracteres", "punch repetido\n(id de 151 caracteres)"),
            Field("Tipo de marca", "0", "CHECK_IN o CHECK_OUT; si falta puede quedar UNKNOWN", "Valor del catalogo", "CHECK_OUT", "Valor fuera de catalogo", "SALIDA"),
            Field("Payload", "0", "Objeto JSON opcional con datos crudos del reloj", "JSON", "{\"ip\":\"10.0.0.5\"}", "Payload no serializable", "binario invalido"),
            Field("Secreto del dispositivo", "1", "Debe coincidir con el hash registrado", "Token secreto configurado", "cabecera valida", "Faltante o incorrecto", "secreto incorrecto"),
        ],
    ),
    Module(
        "Modulo DNI y Verificacion",
        [
            Field("Imagen DNI", "1", "Imagen base64 o archivo de imagen; maximo 5MB en frontend", "PNG/JPG claro", "dni_frente.jpg", "Archivo no imagen, imagen vacia o demasiado grande", "documento.pdf\nimagen de 6MB"),
            Field("Nombre declarado", "1", "Requerido antes de comparar identidad", "Texto", "Ana", "Vacio", "NULL"),
            Field("Apellido declarado", "1", "Requerido antes de comparar identidad", "Texto", "Silva", "Vacio", "NULL"),
            Field("Cedula declarada", "1", "Cedula uruguaya valida", "Digitos validos", "1.234.567-2", "Cedula invalida", "123"),
            Field("Fecha nacimiento declarada", "1", "Fecha valida; no futura; edad minima 5 anos", "Fecha", "2012-09-14", "Fecha futura o invalida", "2030-01-01"),
            Field("Token de sesion Didit", "0", "UUID de sesion vigente", "UUID", "550e8400-e29b-41d4-a716-446655440000", "UUID invalido o vencido", "abc\nsesion expirada"),
            Field("Estado Didit", "0", "PENDING, IN_PROGRESS, APPROVED, DECLINED, EXPIRED, ABANDONED o ERROR", "Valor del catalogo", "APPROVED", "Estado desconocido", "OK"),
        ],
    ),
    Module(
        "Modulo Notificaciones",
        [
            Field("Tipo", "1", "LICENSE_CREATED, LICENSE_UPDATED, EVENT_ASSIGNED o ATTENDANCE_INCIDENT", "Valor del catalogo", "EVENT_ASSIGNED", "Tipo inexistente", "MENSAJE"),
            Field("Titulo", "1", "Texto obligatorio", "Texto", "Nuevo evento asignado", "Vacio", "NULL"),
            Field("Cuerpo", "1", "Texto obligatorio", "Texto", "Tenes una clase asignada", "Vacio", "NULL"),
            Field("URL de accion", "0", "Ruta interna opcional", "URL o path", "/teacher/events", "URL malformada si el cliente la exige", "http://"),
            Field("Solo no leidas", "0", "Filtro true o false", "true / false", "true", "Valor fuera de lista", "si"),
            Field("Endpoint push", "1", "URL unica del navegador", "URL endpoint", "https://push.service/abc", "Vacio o duplicado invalido", "NULL"),
            Field("Clave p256dh", "1", "Texto criptografico de suscripcion", "Base64/string", "BOrandomKey", "Vacio", "NULL"),
            Field("Clave auth", "1", "Texto criptografico de suscripcion", "Base64/string", "authSecret", "Vacio", "NULL"),
        ],
    ),
    Module(
        "Modulo Reportes, Analiticas y Exportaciones",
        [
            Field("Reporte", "1", "attendance_detail o monthly_summary", "Valor del catalogo", "attendance_detail", "Reporte inexistente", "usuarios"),
            Field("Formato", "1", "PDF, XLSX o CSV segun reporte", "Valor del catalogo", "XLSX", "Formato inexistente", "DOCX"),
            Field("Desde", "1", "Formato YYYY-MM-DD", "Fecha valida", "2026-05-01", "Formato invalido", "01/05/2026"),
            Field("Hasta", "1", "Formato YYYY-MM-DD; debe ser coherente con Desde", "Fecha valida", "2026-05-31", "Formato invalido o anterior si el reporte lo rechaza", "2026/05/31"),
            Field("Filtro rol", "0", "ADMIN, STAFF o TEACHER", "Valor del catalogo", "TEACHER", "Rol inexistente", "ESTUDIANTE"),
            Field("Filtro usuario", "0", "UUID de usuario", "UUID existente", "550e8400-e29b-41d4-a716-446655440000", "UUID invalido", "usuario"),
            Field("Filtro tipo evento", "0", "Tipo de evento valido", "Valor del catalogo", "CLASE", "Tipo inexistente", "EXAMEN"),
            Field("Filtro estado asistencia", "0", "Estado de asistencia valido", "Valor del catalogo", "PRESENT", "Estado inexistente", "PENDIENTE"),
            Field("Limite", "0", "Entero positivo", "Numero entero", "100", "Cero, negativo o texto", "0\n-1\nmuchos"),
            Field("Offset", "0", "Entero mayor o igual a 0", "Numero entero", "0", "Negativo o texto", "-1\ninicio"),
        ],
    ),
]


def col_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def cell(ref: str, value: object, style: int) -> str:
    text = esc(value)
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def row_xml(index: int, values: Iterable[object], style: int, height: int | None = None) -> str:
    attrs = f' r="{index}"'
    if height is not None:
        attrs += f' ht="{height}" customHeight="1"'
    cells = "".join(cell(f"{col_name(i)}{index}", value, style) for i, value in enumerate(values, 1))
    return f"<row{attrs}>{cells}</row>"


def build_sheet() -> str:
    rows: list[str] = []
    merges: list[str] = []
    row_idx = 1

    for module in MODULES:
        rows.append(row_xml(row_idx, [module.title, "", "", "", "", "", ""], 1, 30))
        merges.append(f'<mergeCell ref="A{row_idx}:G{row_idx}"/>')
        row_idx += 1
        rows.append(row_xml(row_idx, ["", "", "", "", "", "", ""], 0, 8))
        row_idx += 1
        rows.append(row_xml(row_idx, HEADERS, 2, 28))
        row_idx += 1
        for field in module.fields:
            rows.append(
                row_xml(
                    row_idx,
                    [
                        field.name,
                        field.required,
                        field.restrictions,
                        field.valid_data,
                        field.valid_examples,
                        field.invalid_data,
                        field.invalid_examples,
                    ],
                    3,
                    58,
                )
            )
            row_idx += 1
        rows.append(row_xml(row_idx, ["", "", "", "", "", "", ""], 0, 10))
        row_idx += 1

    cols = """
    <cols>
      <col min="1" max="1" width="27" customWidth="1"/>
      <col min="2" max="2" width="13" customWidth="1"/>
      <col min="3" max="3" width="42" customWidth="1"/>
      <col min="4" max="4" width="32" customWidth="1"/>
      <col min="5" max="5" width="30" customWidth="1"/>
      <col min="6" max="6" width="34" customWidth="1"/>
      <col min="7" max="7" width="32" customWidth="1"/>
    </cols>
    """
    merge_xml = f'<mergeCells count="{len(merges)}">{"".join(merges)}</mergeCells>'
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  {cols}
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>{"".join(rows)}</sheetData>
  {merge_xml}
  <pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>'''


def write_xlsx(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Clases de Equivalencia" sheetId="1" r:id="rId1"/></sheets>
</workbook>''',
        "xl/styles.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
    <font><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>''',
        "xl/worksheets/sheet1.xml": build_sheet(),
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)


if __name__ == "__main__":
    write_xlsx(OUTPUT)
    print(OUTPUT)
