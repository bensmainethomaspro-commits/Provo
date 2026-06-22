export default function ConfirmDialog({ icon = '❓', title, message, onConfirm, onCancel,
  confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false, extra = null }) {
  return (
    <div className="confirm-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-box">
        <div className="confirm-box__icon">{icon}</div>
        <div className="confirm-box__title">{title}</div>
        <div className="confirm-box__text">{message}</div>
        {extra}
        <div className="confirm-box__actions">
          <button className="btn btn--secondary btn--full" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn btn--full ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
