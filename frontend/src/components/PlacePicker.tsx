import './place-picker.css'

export function PlacePicker({ name, address, legacy, disabled, error, onChange }: {
  name: string; address: string; legacy?: string; disabled?: boolean; error?: string
  onChange: (key: 'placeName' | 'placeAddress', value: string) => void
}) {
  return <fieldset className="meeting-place-fields"><legend>Где встречаемся?</legend>
    {legacy && <p className="small-note">Сохранённое место: {legacy}. Чтобы изменить его, заполни оба поля</p>}
    <label className="field">Название места<input name="placeName" value={name} maxLength={160} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? 'error-place' : 'place-advice'} placeholder="Например, Кофемания" onChange={event => {
      const parts = event.target.value.split('|')
      if (parts.length === 2 && !address) { onChange('placeName', parts[0].trim()); onChange('placeAddress', parts[1].trim()) }
      else onChange('placeName', event.target.value)
    }} /></label>
    <label className="field">Адрес<input name="placeAddress" value={address} maxLength={300} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? 'error-place' : 'place-advice'} placeholder="Город, улица и номер дома" onChange={event => onChange('placeAddress', event.target.value)} /></label>
    <p className="small-note" id="place-advice">Для первой встречи рекомендуем выбирать общественные места. Не указывайте домашний адрес</p>
    {error && <p id="error-place" role="alert" className="field-error">{error}</p>}
  </fieldset>
}
