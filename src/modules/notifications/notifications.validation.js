import { strict } from "../../shared/validation.js";
export const notificationsSchemas = [
  ["POST", /^\/api\/notifications\/[a-f\d]{24}\/read$/, strict({})],
];
