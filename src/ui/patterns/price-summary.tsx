import type { ReactNode } from "react";

export interface PriceMetric {
  label: string;
  amount: string;
  detail: string;
}

export function PriceSummary({
  metrics,
  actions,
}: {
  metrics: readonly PriceMetric[];
  actions: ReactNode;
}) {
  return (
    <footer className="trip-checkout-bar" aria-label="Trip price summary">
      {metrics.map((metric) => (
        <div className="trip-total" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.amount}</strong>
          <small>{metric.detail}</small>
        </div>
      ))}
      <div className="checkout-divider" aria-hidden="true" />
      {actions}
    </footer>
  );
}
