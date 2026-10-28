/** El grupo de un filtro de libretas: su oferta y, si tiene, su orientación. */
export type GroupFilter = { courseOfferingId: string; courseOrientationId: string | null }

/**
 * El grupo como parámetros de consulta. Sin orientación va sólo la oferta; con orientación, el
 * backend trae las libretas de esa orientación más las de tronco común.
 */
export function groupParams(group: GroupFilter | null): Record<string, string> {
  if (!group) return {}
  return group.courseOrientationId
    ? { courseOfferingId: group.courseOfferingId, courseOrientationId: group.courseOrientationId }
    : { courseOfferingId: group.courseOfferingId }
}
