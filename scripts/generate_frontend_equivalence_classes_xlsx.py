#!/usr/bin/env python3
from __future__ import annotations

import html
import os
import zipfile
from dataclasses import dataclass
from typing import Iterable


OUTPUT = os.path.join(os.getcwd(), "Clases_de_Equivalencia_Frontend.xlsx")


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
    "Datos Válidos",
    "Ejemplos Válidos",
    "Datos Inválidos",
    "Ejemplos Inválidos",
]


MODULES = [
    Module(
        "Inicio de Sesión",
        [
            Field("Email o Usuario", "1", "Debe ingresarse un email o nombre de usuario visible para el usuario", "Email con formato válido o usuario registrado", "ana@correo.com\nana.perez", "Campo vacío o dato no registrado", "NULL\nusuario_inexistente"),
            Field("Contraseña", "1", "Debe ingresarse la contraseña de la cuenta", "Texto no vacío", "MiClave2026!", "Campo vacío o contraseña incorrecta", "NULL\nclave_mal"),
            Field("Código de autenticación", "0", "Solo se pide cuando la cuenta tiene verificación en dos pasos", "Código de 6 dígitos o código de respaldo válido", "123456\nABCD-1234", "Código vacío, vencido o incorrecto", "NULL\n000000"),
            Field("Botón mostrar contraseña", "0", "Debe alternar entre ocultar y mostrar el texto ingresado", "Click en el botón de visibilidad", "Contraseña visible y luego oculta", "No cambia el estado visual", "El campo sigue igual siempre"),
            Field("Acceso con Google", "0", "Debe iniciar el flujo externo al presionar el botón", "Click en Continuar con Google", "Se redirige al inicio de Google", "No redirige o muestra error", "Pantalla queda sin cambios"),
            Field("Mensaje de error", "0", "Debe mostrarse cuando el login no puede completarse", "Credenciales inválidas, cuenta bloqueada o cuenta inactiva", "Credenciales inválidas", "Mensaje ausente o confuso", "No aparece nada"),
        ],
    ),
    Module(
        "Registro de Usuario",
        [
            Field("Email", "1", "Debe tener formato de correo", "Correo válido", "usuario@correo.com", "Vacío o sin formato de correo", "NULL\nusuario.com\nusuario@"),
            Field("Usuario", "1", "Debe ser un nombre de usuario aceptado por el formulario", "Letras, números, punto, guion o guion bajo", "ana.perez_1", "Vacío, muy corto o con símbolos no permitidos", "NULL\nap\nana*"),
            Field("Nombre", "1", "Debe completarse con texto visible", "Texto alfabético", "Ana", "Campo vacío", "NULL"),
            Field("Apellido", "1", "Debe completarse con texto visible", "Texto alfabético", "Pérez", "Campo vacío", "NULL"),
            Field("Cédula", "1", "Debe ingresarse una cédula uruguaya válida", "Cédula válida con o sin puntos y guion", "1.234.567-2", "Vacía, incompleta o inválida", "NULL\n123\n11111111"),
            Field("Celular", "0", "Si se completa, debe ser un celular uruguayo válido", "Número que empieza con 09", "094123456", "Número incompleto o con formato inválido", "12345\n+598"),
            Field("Fecha de nacimiento", "1", "Debe ser una fecha válida y no futura", "Fecha seleccionada en el calendario", "2008-05-10", "Vacía, futura o inválida", "NULL\n2035-01-01"),
            Field("Vencimiento del documento", "1", "Debe ser una fecha válida del documento", "Fecha seleccionada en el calendario", "2030-08-15", "Vacía o inválida", "NULL\ntexto"),
            Field("Perfil", "1", "Debe seleccionarse una opción del formulario", "Perfil disponible en la pantalla", "Docente", "Sin selección o valor que no aparece", "NULL\nAdministrador"),
            Field("Contraseña", "1", "Debe cumplir la fortaleza pedida por el frontend", "Contraseña fuerte", "EduTrack2026!", "Vacía o débil", "NULL\n123456\npassword"),
            Field("Confirmar contraseña", "1", "Debe coincidir con la contraseña", "Mismo texto que contraseña", "EduTrack2026!", "No coincide", "EduTrack2025!"),
            Field("Verificación de identidad", "0", "Si aparece, debe completarse antes de finalizar el registro", "Verificación aprobada", "Verificación completada", "Pendiente, rechazada o cancelada", "No completada"),
        ],
    ),
    Module(
        "Recuperar y Restablecer Contraseña",
        [
            Field("Email de recuperación", "1", "Debe tener formato de correo", "Correo válido", "usuario@correo.com", "Vacío o email mal escrito", "NULL\nusuario.com"),
            Field("Captcha", "0", "Si aparece en pantalla, debe validarse antes de enviar", "Captcha resuelto", "Validación completada", "Captcha sin resolver o vencido", "NULL\ncaptcha vencido"),
            Field("Enlace de recuperación", "1", "Debe abrir la pantalla de restablecimiento con token válido", "Enlace vigente recibido por email", "Link de recuperación válido", "Enlace vencido, inválido o sin token", "link sin token\nlink vencido"),
            Field("Nueva contraseña", "1", "Debe cumplir la fortaleza pedida por el frontend", "Contraseña fuerte", "NuevaClave2026!", "Vacía o débil", "NULL\n123456"),
            Field("Confirmar nueva contraseña", "1", "Debe coincidir con la nueva contraseña", "Mismo texto que nueva contraseña", "NuevaClave2026!", "No coincide", "OtraClave2026!"),
        ],
    ),
    Module(
        "Mi Perfil",
        [
            Field("Usuario", "1", "Debe mantener un formato aceptado por el formulario", "Usuario válido", "maria.rodriguez", "Vacío, muy corto o con símbolos no permitidos", "NULL\nmr\nmaria*"),
            Field("Nombre", "1", "Debe completarse con texto visible", "Texto válido", "María", "Campo vacío", "NULL"),
            Field("Apellido", "1", "Debe completarse con texto visible", "Texto válido", "Rodríguez", "Campo vacío", "NULL"),
            Field("Cédula", "0", "Solo editable si la pantalla lo permite; si se edita debe ser válida", "Cédula uruguaya válida", "4.567.890-1", "Cédula inválida o campo bloqueado editado", "123\n11111111"),
            Field("Celular", "0", "Si se completa, debe tener formato de celular uruguayo", "Número local válido", "099123456", "Número incompleto o inválido", "555\nabc"),
            Field("Fecha de nacimiento", "0", "Si se completa, debe ser una fecha válida y no futura", "Fecha válida", "1995-03-20", "Fecha futura o texto", "2035-01-01\nmañana"),
            Field("Contraseña actual", "1", "Requerida para cambiar contraseña si la cuenta tiene contraseña", "Contraseña actual correcta", "ClaveActual2026!", "Vacía o incorrecta", "NULL\nclave_mal"),
            Field("Nueva contraseña", "1", "Debe cumplir la fortaleza pedida por el frontend", "Contraseña fuerte", "NuevaClave2026!", "Vacía o débil", "NULL\n123456"),
            Field("Código 2FA", "0", "Se usa para activar o desactivar verificación en dos pasos", "Código válido de la app", "123456", "Código vacío o incorrecto", "NULL\n000000"),
        ],
    ),
    Module(
        "Gestión de Usuarios",
        [
            Field("Búsqueda", "0", "Debe permitir buscar por texto visible", "Nombre, apellido, email o usuario", "ana", "Texto sin coincidencias", "zzzzzz"),
            Field("Email", "1", "Debe tener formato de correo", "Correo válido", "docente@correo.com", "Vacío o mal escrito", "NULL\ndocente.com"),
            Field("Perfil", "1", "Debe elegirse una opción disponible en la pantalla", "Perfil listado", "Docente", "Sin selección o valor inexistente", "NULL\nPerfil inexistente"),
            Field("Estado del usuario", "1", "Debe seleccionarse un estado disponible", "Activo o Inactivo", "Activo", "Sin selección o valor fuera de lista", "NULL\nSuspendido"),
            Field("Aprobación", "0", "Debe cambiarse usando el control visible", "Aprobado o pendiente", "Aprobado", "Valor que no aparece en pantalla", "Tal vez"),
            Field("Formulario de edición", "1", "Debe guardar cuando los campos requeridos están completos", "Datos requeridos válidos", "Usuario actualizado", "Faltan campos obligatorios", "Email vacío"),
        ],
    ),
    Module(
        "Gestión de Estudiantes",
        [
            Field("Nombre", "1", "Debe completarse con texto visible", "Texto válido", "Lucía", "Campo vacío", "NULL"),
            Field("Apellido", "1", "Debe completarse con texto visible", "Texto válido", "Gómez", "Campo vacío", "NULL"),
            Field("Cédula", "1", "Debe ingresarse una cédula válida", "Cédula uruguaya válida", "5.432.109-8", "Vacía o inválida", "NULL\n123"),
            Field("Curso", "1", "Debe seleccionarse un curso disponible", "Curso listado", "1A", "Sin selección o curso inexistente", "NULL\nCurso X"),
            Field("Estado", "1", "Debe seleccionarse un estado disponible", "Activo o Inactivo", "Activo", "Valor fuera de lista", "Suspendido"),
            Field("Búsqueda/Filtro", "0", "Debe filtrar usando los datos visibles", "Texto o curso existente", "Lucía\n1A", "Filtro sin resultados", "zzzzzz"),
        ],
    ),
    Module(
        "Gestión de Cursos",
        [
            Field("Nombre del curso", "1", "Debe completarse con texto visible", "Nombre válido", "1A Matutino", "Campo vacío", "NULL"),
            Field("Código", "0", "Si se completa, debe ser un código corto y reconocible", "Código válido", "1A-2026", "Código duplicado o demasiado largo", "Código ya usado"),
            Field("Descripción", "0", "Texto libre opcional", "Descripción breve", "Grupo de primer año", "Texto excesivamente largo", "Texto muy largo"),
            Field("Estado", "1", "Debe seleccionarse con el control visible", "Activo o Inactivo", "Activo", "Valor fuera de lista", "Cerrado"),
            Field("Guardar curso", "1", "Debe permitir guardar solo con los campos obligatorios válidos", "Formulario completo", "Curso guardado", "Faltan obligatorios", "Nombre vacío"),
        ],
    ),
    Module(
        "Gestión de Eventos",
        [
            Field("Título", "1", "Debe completarse con texto visible", "Texto válido", "Clase de Matemática", "Campo vacío", "NULL"),
            Field("Tipo de evento", "1", "Debe seleccionarse una opción disponible", "Tipo listado", "Clase", "Sin selección o tipo inexistente", "NULL\nExamen especial"),
            Field("Fecha", "1", "Debe seleccionarse una fecha válida", "Fecha de calendario", "2026-05-20", "Vacía o inválida", "NULL\ntexto"),
            Field("Hora inicio", "1", "Debe ser una hora válida", "Hora en formato de la pantalla", "08:00", "Vacía o inválida", "NULL\n25:00"),
            Field("Hora fin", "1", "Debe ser posterior a la hora de inicio", "Hora válida posterior", "09:30", "Igual o anterior al inicio", "08:00\n07:30"),
            Field("Asignado a", "0", "Si se selecciona, debe ser una persona disponible", "Usuario listado", "Docente Ana", "Persona no listada", "Usuario inexistente"),
            Field("Curso", "0", "Si se selecciona, debe ser un curso disponible", "Curso listado", "2B", "Curso no listado", "Curso X"),
            Field("Repetición", "0", "Si se activa, deben completarse las opciones visibles de repetición", "Semanal hasta una fecha válida", "Todos los lunes hasta 30/06", "Repetición incompleta o fecha final anterior", "Sin día seleccionado"),
            Field("Motivo de cancelación", "0", "Requerido cuando se cancela un evento si la pantalla lo pide", "Texto breve", "Docente ausente", "Vacío al cancelar", "NULL"),
        ],
    ),
    Module(
        "Asistencias",
        [
            Field("Filtro de fecha desde", "0", "Si se usa, debe ser una fecha válida", "Fecha de calendario", "2026-05-01", "Texto o fecha inválida", "ayer\n32/13/2026"),
            Field("Filtro de fecha hasta", "0", "Si se usa, debe ser igual o posterior a desde", "Fecha válida posterior", "2026-05-31", "Anterior a desde o inválida", "2026-04-01"),
            Field("Filtro de usuario", "0", "Debe seleccionarse una persona disponible", "Usuario listado", "Docente Ana", "Usuario inexistente", "Persona X"),
            Field("Filtro de estado", "0", "Debe seleccionarse un estado disponible en pantalla", "Presente, tarde, ausente o justificado", "Presente", "Estado fuera de lista", "Pendiente"),
            Field("Filtro de curso/evento", "0", "Debe seleccionarse una opción visible", "Curso o evento listado", "1A\nClase de Historia", "Opción inexistente", "Curso X"),
            Field("Paginación", "0", "Debe navegar entre páginas disponibles", "Página anterior o siguiente habilitada", "Página 2", "Ir a una página inexistente", "Página sin resultados fuera de rango"),
        ],
    ),
    Module(
        "Licencias",
        [
            Field("Usuario", "1", "Debe seleccionarse una persona disponible si la pantalla lo pide", "Usuario listado", "Docente Ana", "Sin selección o usuario inexistente", "NULL\nPersona X"),
            Field("Tipo de licencia", "1", "Debe seleccionarse una opción disponible", "Tipo listado", "Médica", "Sin selección o tipo inexistente", "NULL\nVacaciones especiales"),
            Field("Fecha inicio", "1", "Debe ser una fecha válida", "Fecha de calendario", "2026-05-01", "Vacía o inválida", "NULL\ntexto"),
            Field("Fecha fin", "1", "Debe ser igual o posterior a la fecha inicio", "Fecha válida posterior", "2026-05-10", "Anterior a inicio o inválida", "2026-04-30"),
            Field("Motivo", "1", "Debe completarse con texto visible", "Texto breve", "Reposo médico", "Campo vacío", "NULL"),
            Field("Certificado", "0", "Si se adjunta, debe ser un archivo aceptado por la pantalla", "Imagen o PDF válido", "certificado.pdf", "Archivo no permitido o demasiado grande", "archivo.exe"),
            Field("Estado", "0", "Debe seleccionarse una opción visible si aparece", "Activa o inactiva", "Activa", "Valor fuera de lista", "Pendiente"),
        ],
    ),
    Module(
        "Reportes y Analíticas",
        [
            Field("Tipo de reporte", "1", "Debe seleccionarse una opción disponible", "Reporte listado", "Resumen mensual", "Sin selección o reporte inexistente", "NULL\nReporte X"),
            Field("Formato", "1", "Debe seleccionarse un formato disponible", "PDF, Excel o CSV si aparecen", "Excel", "Formato no disponible", "Word"),
            Field("Fecha desde", "1", "Debe ser una fecha válida", "Fecha de calendario", "2026-05-01", "Vacía o inválida", "NULL\ntexto"),
            Field("Fecha hasta", "1", "Debe ser igual o posterior a desde", "Fecha válida posterior", "2026-05-31", "Anterior a desde", "2026-04-01"),
            Field("Filtros", "0", "Deben usarse opciones visibles de la pantalla", "Curso, usuario, estado o tipo existente", "Curso 1A", "Filtro inexistente", "Curso X"),
            Field("Exportar", "1", "Debe generar archivo solo con filtros válidos", "Click con formulario válido", "Archivo descargado", "Click con datos incompletos", "No se genera archivo"),
        ],
    ),
    Module(
        "Notificaciones",
        [
            Field("Lista de notificaciones", "1", "Debe mostrar notificaciones disponibles para el usuario", "Notificaciones leídas o no leídas", "Evento asignado", "Lista vacía cuando debería haber datos", "No aparece la notificación esperada"),
            Field("Filtro no leídas", "0", "Debe alternar entre todas y no leídas", "Filtro activado o desactivado", "Solo no leídas", "No cambia la lista", "Muestra las mismas siempre"),
            Field("Marcar como leída", "0", "Debe cambiar el estado visible de la notificación", "Click sobre la acción", "Notificación queda leída", "No cambia el estado", "Sigue como no leída"),
            Field("Permiso del navegador", "0", "Si se activa push, el navegador debe permitir la suscripción", "Permiso concedido", "Notificaciones activadas", "Permiso bloqueado o rechazado", "Notificaciones bloqueadas"),
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
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{esc(value)}</t></is></c>'


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
      <col min="1" max="1" width="24" customWidth="1"/>
      <col min="2" max="2" width="13" customWidth="1"/>
      <col min="3" max="3" width="42" customWidth="1"/>
      <col min="4" max="4" width="31" customWidth="1"/>
      <col min="5" max="5" width="29" customWidth="1"/>
      <col min="6" max="6" width="34" customWidth="1"/>
      <col min="7" max="7" width="30" customWidth="1"/>
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
  <sheets><sheet name="Clases Frontend" sheetId="1" r:id="rId1"/></sheets>
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
