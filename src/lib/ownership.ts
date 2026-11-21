import type { UserRole } from "../modules/auth/auth.types.js";

export type OwnedResource = "sensor" | "talhao";

export type OwnershipUser = {
  id: string;
  role: UserRole;
};

export type OwnershipRepository = {
  findOwnerId(resource: OwnedResource, resourceId: string): Promise<string | null>;
};

export type OwnershipLogger = {
  blocked(input: {
    control: "IDOR";
    reason: string;
    userId: string;
    ip: string;
    resource: string;
  }): void;
  adminAccess(input: {
    control: "IDOR";
    userId: string;
    ip: string;
    resource: string;
  }): void;
};

export class ResourceNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super("Recurso não encontrado");
    this.name = "ResourceNotFoundError";
  }
}

export function createOwnershipChecker(
  repository: OwnershipRepository,
  logger: OwnershipLogger,
) {
  return async function assertCanAccessResource(
    user: OwnershipUser,
    resource: OwnedResource,
    resourceId: string,
    ip: string,
  ): Promise<void> {
    const ownerId = await repository.findOwnerId(resource, resourceId);
    const resourceName = `${resource}:${resourceId}`;

    if (ownerId === null) {
      logger.blocked({
        control: "IDOR",
        reason: "nao_encontrado",
        userId: user.id,
        ip,
        resource: resourceName,
      });
      throw new ResourceNotFoundError();
    }

    if (user.role === "ADMIN") {
      logger.adminAccess({
        control: "IDOR",
        userId: user.id,
        ip,
        resource: resourceName,
      });
      return;
    }

    if (ownerId !== user.id) {
      logger.blocked({
        control: "IDOR",
        reason: "proprietario_diferente",
        userId: user.id,
        ip,
        resource: resourceName,
      });
      throw new ResourceNotFoundError();
    }
  };
}
