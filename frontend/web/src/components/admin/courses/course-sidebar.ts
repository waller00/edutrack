import type { CourseRow } from './course-types'
import { courseShortLabel } from './course-types'

export type CourseGroup = {
  key: string
  title: string
  items: Array<CourseRow & { displayLabel: string }>
}

export function groupCoursesForSidebar(courses: CourseRow[]): CourseGroup[] {
  const buckets = new Map<string, CourseGroup>()
  buckets.set('EBI', { key: 'EBI', title: 'EBI', items: [] })
  buckets.set('EMS', { key: 'EMS', title: 'EMS', items: [] })
  buckets.set('OTROS', { key: 'OTROS', title: 'Otros', items: [] })

  for (const course of courses) {
    const key = course.level === 'EBI' || course.level === 'EMS' ? course.level : 'OTROS'
    const group = buckets.get(key) ?? buckets.get('OTROS')!
    group.items.push({
      ...course,
      displayLabel: courseShortLabel(course.name),
    })
  }

  return [...buckets.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => {
        if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        return a.name.localeCompare(b.name, 'es')
      }),
    }))
    .filter((g) => g.items.length > 0)
}
