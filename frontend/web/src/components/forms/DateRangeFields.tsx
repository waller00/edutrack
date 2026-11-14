'use client'

import { useId } from 'react'
import DateField from './DateField'

type DateRangeFieldsProps = {
  startDate: string
  endDate: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
}

const inputClassName = 'w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400'

export default function DateRangeFields({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateRangeFieldsProps) {
  // Se usa en más de una pantalla (y puede haber dos en la misma): ids propios de cada instancia.
  const id = useId()
  const startId = `${id}-start`
  const endId = `${id}-end`
  return (
    <>
      <div>
        <label htmlFor={startId} className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
        <DateField id={startId} value={startDate} onChange={onStartDateChange} className={inputClassName} />
      </div>

      <div>
        <label htmlFor={endId} className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
        <DateField id={endId} value={endDate} onChange={onEndDateChange} className={inputClassName} />
      </div>
    </>
  )
}
