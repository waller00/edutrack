import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminBiometricDevicesPanel from './AdminBiometricDevicesPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const devices = [
  {
    id: 'd1',
    code: 'F22-LOCAL-01',
    name: 'ZKTeco F22 Local',
    admsSerial: null,
    timezone: 'America/Montevideo',
    isActive: true,
    allowedIps: [],
    lastSeenAt: '2026-05-20T14:46:00.000Z',
    createdAt: '2026-05-20T14:46:00.000Z',
    updatedAt: '2026-05-20T14:46:00.000Z',
    _count: { mappings: 5, punches: 1, linkRequests: 0 },
  },
  {
    id: 'd2',
    code: 'F22-TEST-01',
    name: 'ZKTeco F22 Testing',
    admsSerial: 'SRN5260500102',
    timezone: 'America/Montevideo',
    isActive: true,
    allowedIps: [],
    lastSeenAt: '2026-05-23T18:22:00.000Z',
    createdAt: '2026-05-23T18:22:00.000Z',
    updatedAt: '2026-05-23T18:22:00.000Z',
    _count: { mappings: 6, punches: 18, linkRequests: 0 },
  },
]

describe('AdminBiometricDevicesPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('abre el detalle al seleccionar un lector sin mostrarlo de entrada', async () => {
    mockedApi.mockResolvedValue({ devices })
    render(<AdminBiometricDevicesPanel />)
    expect(await screen.findAllByText('ZKTeco F22 Local')).toHaveLength(1)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    const row = screen.getByRole('button', {
      name: 'Ver lector ZKTeco F22 Local',
    })
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('Información técnica y uso'))
    expect(screen.getByText('Sin serial')).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver lector ZKTeco F22 Testing' }),
    )
    expect(screen.queryByText('Sin serial')).not.toBeInTheDocument()
    expect(screen.getByText('SRN5260500102')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lectores' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('avisa qué le falta a un lector para recibir marcas por iClock', async () => {
    const configured = {
      ...devices[1],
      id: 'd3',
      name: 'ZKTeco F22 Configurado',
      allowedIps: ['190.64.10.20'],
    }
    mockedApi.mockResolvedValue({ devices: [...devices, configured] })
    render(<AdminBiometricDevicesPanel />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Ver lector ZKTeco F22 Local' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'No recibe marcas del reloj (iClock): falta número de serie e IPs permitidas.',
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Ver lector ZKTeco F22 Testing' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('falta IPs permitidas.')

    fireEvent.click(
      screen.getByRole('button', { name: 'Ver lector ZKTeco F22 Configurado' }),
    )
    expect(screen.queryByText(/No recibe marcas del reloj/)).not.toBeInTheDocument()
  })

  it('busca por nombre, código y serial sin cambiar los datos', async () => {
    mockedApi.mockResolvedValue({ devices })
    render(<AdminBiometricDevicesPanel />)
    await screen.findByRole('button', { name: 'Ver lector ZKTeco F22 Local' })
    fireEvent.change(screen.getByLabelText('Buscar lector'), {
      target: { value: 'SRN526' },
    })
    expect(
      screen.queryByRole('button', { name: 'Ver lector ZKTeco F22 Local' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Ver lector ZKTeco F22 Testing' }),
    ).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('edita un lector sin reemplazar su clave al dejarla vacía', async () => {
    mockedApi
      .mockResolvedValueOnce({ devices })
      .mockResolvedValueOnce({ device: { ...devices[0], name: 'Entrada' } })
    render(<AdminBiometricDevicesPanel />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Ver lector ZKTeco F22 Local',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Editar lector' }))
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Entrada' },
    })
    expect(screen.getByLabelText('IPs permitidas')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lector' }))
    await screen.findByText('Lector actualizado correctamente.')
    const update = mockedApi.mock.calls.find(
      ([, options]) => options?.method === 'PUT',
    )
    expect(update?.[0]).toBe('/biometric/admin/devices/d1')
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({
      code: devices[0].code,
      name: 'Entrada',
      admsSerial: null,
      allowedIps: [],
      isActive: true,
    })
  })

  it('crea un lector con clave obligatoria y conserva serial e IPs avanzadas', async () => {
    mockedApi
      .mockResolvedValueOnce({ devices: [] })
      .mockResolvedValueOnce({ device: devices[0] })
    render(<AdminBiometricDevicesPanel />)
    await screen.findByText('Todavía no hay lectores configurados.')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo lector' }))
    expect(
      screen.getByRole('button', { name: 'Guardar lector' }),
    ).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Entrada' },
    })
    fireEvent.change(screen.getByLabelText('Código'), {
      target: { value: 'ENTRADA' },
    })
    fireEvent.change(screen.getByLabelText('Clave del lector'), {
      target: { value: 'clave-test' },
    })
    fireEvent.click(screen.getByText('Conexión y opciones avanzadas'))
    fireEvent.change(screen.getByLabelText('Número de serie (ADMS)'), {
      target: { value: ' SN-01 ' },
    })
    fireEvent.change(screen.getByLabelText('IPs permitidas'), {
      target: { value: '10.0.0.1, 10.0.0.2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lector' }))
    await screen.findByText('Lector creado correctamente.')
    const create = mockedApi.mock.calls.find(
      ([, options]) => options?.method === 'POST',
    )
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({
      code: 'ENTRADA',
      name: 'Entrada',
      admsSerial: 'SN-01',
      secret: 'clave-test',
      allowedIps: ['10.0.0.1', '10.0.0.2'],
      isActive: true,
    })
  })

  it('cambiar el estado sólo envía el nuevo estado del lector elegido', async () => {
    mockedApi
      .mockResolvedValueOnce({ devices })
      .mockResolvedValueOnce({ device: { ...devices[0], isActive: false } })
    render(<AdminBiometricDevicesPanel />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Ver lector ZKTeco F22 Local',
      }),
    )
    expect(
      screen.getByRole('button', { name: 'Deshabilitar lector' }),
    ).not.toBeVisible()
    fireEvent.click(screen.getByText('Cambiar estado del lector'))
    fireEvent.click(screen.getByRole('button', { name: 'Deshabilitar lector' }))
    await screen.findByText('Lector deshabilitado.')
    expect(mockedApi).toHaveBeenCalledWith('/biometric/admin/devices/d1', {
      method: 'PUT',
      body: JSON.stringify({ isActive: false }),
    })
  })

  it('mantiene el formulario al cancelar el descarte y descarta sólo por decisión del usuario', async () => {
    mockedApi.mockResolvedValue({ devices })
    render(<AdminBiometricDevicesPanel />)
    await screen.findByRole('button', { name: 'Ver lector ZKTeco F22 Local' })
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo lector' }))
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Borrador' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('sin guardar')
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Borrador')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Descartar cambios y continuar' }),
    )
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('permite reintentar si falla la carga', async () => {
    mockedApi
      .mockRejectedValueOnce(new Error('No se pudieron cargar los lectores.'))
      .mockResolvedValueOnce({ devices })
    render(<AdminBiometricDevicesPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron cargar',
    )
    expect(
      screen.queryByText('Todavía no hay lectores configurados.'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(
      await screen.findByRole('button', {
        name: 'Ver lector ZKTeco F22 Local',
      }),
    ).toBeInTheDocument()
  })
})
