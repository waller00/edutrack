import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { clearStudentPhotoCache, useStudentPhoto } from './useStudentPhoto'

const apiBlobMock = vi.fn()
vi.mock('@/lib/api/binary', () => ({ apiBlob: (...args: unknown[]) => apiBlobMock(...args) }))

function Photo({ studentId, hasPhoto = true }: { studentId: string; hasPhoto?: boolean }) {
  const url = useStudentPhoto('gb-1', studentId, hasPhoto)
  return <span data-testid={`photo-${studentId}`}>{url ?? 'sin foto'}</span>
}

describe('useStudentPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStudentPhotoCache()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:foto')
  })

  it('la tarjeta y su miniatura comparten un solo pedido', async () => {
    apiBlobMock.mockResolvedValue(new Blob(['x']))
    render(
      <>
        <Photo studentId="s1" />
        <Photo studentId="s1" />
      </>,
    )

    await waitFor(() => expect(screen.getAllByText('blob:foto')).toHaveLength(2))
    expect(apiBlobMock).toHaveBeenCalledTimes(1)
    expect(apiBlobMock).toHaveBeenCalledWith('/gradebook/gb-1/students/s1/photo')
  })

  it('sin foto cargada no pide nada', () => {
    render(<Photo studentId="s2" hasPhoto={false} />)
    expect(screen.getByTestId('photo-s2')).toHaveTextContent('sin foto')
    expect(apiBlobMock).not.toHaveBeenCalled()
  })

  it('un error no queda en caché: la próxima vez se reintenta', async () => {
    apiBlobMock.mockRejectedValueOnce(new Error('caída')).mockResolvedValueOnce(new Blob(['x']))
    const { unmount } = render(<Photo studentId="s3" />)
    await waitFor(() => expect(apiBlobMock).toHaveBeenCalledTimes(1))
    unmount()

    render(<Photo studentId="s3" />)
    await waitFor(() => expect(screen.getByTestId('photo-s3')).toHaveTextContent('blob:foto'))
    expect(apiBlobMock).toHaveBeenCalledTimes(2)
  })
})
