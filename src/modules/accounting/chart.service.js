export const chart = [
  ["1000", "Bank", "asset"],
  ["1010", "Cash", "asset"],
  ["1100", "Accounts receivable", "asset"],
  ["1200", "Inventory", "asset"],
  ["1300", "Employee advances", "asset"],
  ["2000", "Accounts payable", "liability"],
  ["2100", "Customer deposits", "liability"],
  ["2200", "Salary payable", "liability"],
  ["3000", "Owner capital", "equity"],
  ["3100", "Retained earnings", "equity"],
  ["4000", "Sales revenue", "income"],
  ["4100", "Cancellation income", "income"],
  ["5000", "Cost of goods sold", "expense"],
  ["5100", "Delivery expense", "expense"],
  ["5200", "Salary expense", "expense"],
  ["5300", "Operating expense", "expense"],
].map(([code, name, type]) => ({ code, name, type }));
export const accountNames = new Set(chart.map((x) => x.name));
