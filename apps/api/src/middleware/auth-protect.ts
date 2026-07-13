import { authMiddleware } from "./auth.js";
import { accessMiddleware } from "./permissions.js";

/** Standard authenticated request with loaded permissions and accessVersion check */
export const authProtect = [authMiddleware, accessMiddleware];
