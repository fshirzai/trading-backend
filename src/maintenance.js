import { mountSalesMaintenance } from "./modules/sales/sales.maintenance.js";
import { mountReturnsMaintenance } from "./modules/returns/returns.maintenance.js";
import { mountPaymentsMaintenance } from "./modules/payments/payments.maintenance.js";
export function mountMaintenance(app, config) {
  mountSalesMaintenance(app, config);
  mountReturnsMaintenance(app, config);
  mountPaymentsMaintenance(app, config);
}
