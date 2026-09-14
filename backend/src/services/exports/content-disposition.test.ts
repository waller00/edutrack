import { describe, expect, it } from 'vitest'
import { attachmentDisposition } from './content-disposition.js'

describe('attachmentDisposition', () => {
  it('un nombre ASCII viaja igual en las dos formas', () => {
    const header = attachmentDisposition('boletin.pdf')
    expect(header).toContain('filename="boletin.pdf"')
    expect(header).toContain("filename*=UTF-8''boletin.pdf")
  })

  it('un apellido con tilde no se rompe: es el caso normal acá, no un borde', () => {
    // Sin `filename*`, el navegador recibía "Dýaz" porque las cabeceras son latin-1.
    const header = attachmentDisposition('boletin-Díaz-Ana.pdf')
    expect(header).toContain('filename="boletin-Diaz-Ana.pdf"')
    expect(header).toContain("filename*=UTF-8''boletin-D%C3%ADaz-Ana.pdf")
  })

  it('la ñ también sobrevive', () => {
    expect(attachmentDisposition('Muñoz.pdf')).toContain("filename*=UTF-8''Mu%C3%B1oz.pdf")
  })

  it('las comillas y barras no pueden romper la cabecera', () => {
    const header = attachmentDisposition('ra"ro\\.pdf')
    expect(header).toContain('filename="ra_ro_.pdf"')
  })

  it('lo que no es ASCII imprimible cae a guion bajo en el respaldo', () => {
    expect(attachmentDisposition('中文.pdf')).toContain('filename="__.pdf"')
  })
})
