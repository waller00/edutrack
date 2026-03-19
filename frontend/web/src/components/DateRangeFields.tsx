'use client'

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
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className={inputClassName}
        />
      </div>
    </>
  )
}
