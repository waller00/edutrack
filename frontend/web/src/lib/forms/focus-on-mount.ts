/**
 * Ref que enfoca el campo cuando aparece: al abrir un formulario o un editor con un clic, el foco
 * va a lo que hay que escribir.
 *
 * Es lo mismo que hacía `autoFocus` (React enfoca al montar), pero sin el atributo: `autoFocus` en
 * el HTML se aplica también al cargar una página y desorienta a quien usa lector de pantalla. Va
 * sólo en campos que aparecen por una acción de la persona.
 *
 * Tiene que ser esta función (siempre la misma): una flecha escrita en el JSX es otra en cada
 * render, React la volvería a llamar y el foco saltaría de vuelta a este campo mientras se escribe
 * en otro.
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus()
}
