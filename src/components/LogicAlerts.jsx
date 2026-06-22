import { getLogicAlerts } from '../utils/helpers';

export default function LogicAlerts({ activities }) {
  const alerts = getLogicAlerts(activities);
  if (alerts.length === 0) return null;
  return (
    <div className="logic-alerts">
      {alerts.map((alert, i) => (
        <div key={i} className={`logic-alert logic-alert--${alert.type}`}>
          <span>{alert.icon}</span>
          <span>{alert.message}</span>
        </div>
      ))}
    </div>
  );
}
