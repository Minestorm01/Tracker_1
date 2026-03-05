export interface Staff {
  id: number;
  name: string;
}

export interface DailyBudget {
  date: string;
  total_budget: number;
  total_hours: number;
}

export interface SalesEntry {
  staff_id: number;
  name: string;
  shift_hours: number;
  actual_sales: number;
  target_sales: number;
  ips: number;
  avg_sale: number;
  jcp_sales: number;
  is_submitted: number;
}

export interface MonthlySummary {
  staff: {
    staff_id: number;
    name: string;
    total_sales: number;
    total_target: number;
    total_hours: number;
    avg_ips: number;
    avg_sale_val: number;
  }[];
  store: {
    total_budget: number;
    total_hours: number;
  };
  dailyBudgets?: {
    date: string;
    total_budget: number;
    total_hours: number;
  }[];
}

export interface Repair {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  item_description: string;
  repair_category: string;
  condition_notes: string;
  risk_warnings?: string;
  is_quoted: number;
  quoted_price?: number;
  date_received: string;
  date_sent?: string;
  date_due_back: string;
  jeweller?: string;
  status: 'Received' | 'At Jewellers' | 'Ready to collect' | 'Collected';
  customer_contacted: number;
  comms_notes?: string;
}

export interface Quote {
  id: number;
  customer_name: string;
  inquiry_date: string;
  contact_phone?: string;
  contact_email?: string;
  contact_method: 'Phone' | 'Email' | 'In-Store';
  price_to_begin?: number;
  date_of_quote?: string;
  quote_info: string;
  quoted_price?: number;
  customer_contacted: number;
  status: 'Waiting on jeweller to quote' | 'Waiting — customer not contacted yet' | 'Customer contacted regarding details of quote' | 'Follow-ups running' | 'Follow-ups complete' | 'Accepted' | 'Declined' | 'Closed/Completed';
  approved_date?: string;
}

export interface SpecialOrder {
  id: number;
  source_quote_id?: number;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  item_description: string;
  stone_lab_nat?: string;
  stone_shape?: string;
  stone_carat?: number;
  stone_colour?: string;
  stone_clarity?: string;
  stone_report_no?: string;
  stone_measurements?: string;
  date_ordered: string;
  date_estimated: string;
  date_actual_ready?: string;
  date_collected?: string;
  status: 'Quoted' | 'Ordered' | 'Ready to collect' | 'Collected';
  comms_log?: string;
}
