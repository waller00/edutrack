'use client'

type PhoneBirthdateFieldsProps = {
  phoneLocal: string
  birthdate: string
  onPhoneChange: (value: string) => void
  onBirthdateChange: (value: string) => void
  birthdateRequired?: boolean
}

export default function PhoneBirthdateFields({
  phoneLocal,
  birthdate,
  onPhoneChange,
  onBirthdateChange,
  birthdateRequired = false,
}: PhoneBirthdateFieldsProps) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
        <div className="flex gap-2 items-center">
          <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">+598</span>
          <input
            value={phoneLocal}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="094481122"
            className="input-field flex-1"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Fecha de nacimiento</label>
        <input
          value={birthdate}
          onChange={(e) => onBirthdateChange(e.target.value)}
          type="date"
          required={birthdateRequired}
          max={new Date().toISOString().split('T')[0]}
          className="input-field"
        />
      </div>
    </>
  )
}
