export interface Analysis {
  app_id: string;
  period: string;
  entity: string;
  dataset_name: string;
  source: string;
  as_of: string;
  fingerprint: string;
  metrics: Record<string, number | null>;
  bridge: { label: string; value: number; kind: string }[];
  aging: { label: string; value: number; count: number }[];
  invoices: {
    invoice: string;
    entity: string;
    customer: string;
    due_date: string;
    outstanding: string;
    days_overdue: number;
    bucket: string;
  }[];
  trend: { period: string; revenue: number; budget: number; profit: number }[];
  entities: {
    entity: string;
    revenue: number;
    cost: number;
    opex: number;
    profit: number;
    budget: number;
    cash: number;
  }[];
  issues: { severity: string; title: string; detail: string }[];
  warnings: string[];
  lineage: {
    input: string;
    version: string;
    rows: number;
    formulas: string;
    snapshot: string;
  };
}
