import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";

export function requireRole(roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3473e'},body:JSON.stringify({sessionId:'b3473e',location:'rbac.ts:requireRole:noUser',message:'RBAC rejected - no user',data:{path:request.url},hypothesisId:'H1,H3',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    if (!roles.includes(request.user.role)) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3473e'},body:JSON.stringify({sessionId:'b3473e',location:'rbac.ts:requireRole:forbidden',message:'RBAC rejected - role not in allowed',data:{userRole:request.user.role,allowedRoles:roles,path:request.url},hypothesisId:'H1,H2',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient permissions for this action",
      });
      return;
    }
  };
}

export function requireAdmin() {
  return requireRole(["admin"]);
}
