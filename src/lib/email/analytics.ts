export type BroadcastMetricInput = {
  sentCount: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
};

export type BroadcastMetrics = BroadcastMetricInput & {
  deliveryRate: number | null;
  openRate: number | null;
  clickRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
};

const rate = (value: number, denominator: number) =>
  denominator > 0 ? value / denominator : null;

/** 所有成效率一律以 provider ACCEPTED（EmailBroadcast.sentCount）為分母。 */
export function calculateBroadcastMetrics(
  input: BroadcastMetricInput,
): BroadcastMetrics {
  return {
    ...input,
    deliveryRate: rate(input.delivered, input.sentCount),
    openRate: rate(input.opened, input.sentCount),
    clickRate: rate(input.clicked, input.sentCount),
    bounceRate: rate(input.bounced, input.sentCount),
    complaintRate: rate(input.complained, input.sentCount),
  };
}

export function formatMetricRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 1000) / 10}%`;
}
