import pin from './assets/vecino-pin.svg'

export function Brand() {
  return <span className="vecino-brand" aria-label="Vecino">
    <span aria-hidden="true">Vecino</span>
    <img src={pin} alt="" aria-hidden="true" />
  </span>
}
