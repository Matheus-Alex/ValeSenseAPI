import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { idSchema } from "../src/lib/ids.js";
import {
  createOwnershipChecker,
  ResourceNotFoundError,
  type OwnedResource,
  type OwnershipLogger,
} from "../src/lib/ownership.js";

const sensorId = "64a1b2c3-d4e5-4789-a012-345678901234";
const plotId = "64a1b2c3-d4e5-4789-a012-345678901235";
const ownerId = "64a1b2c3-d4e5-4789-a012-345678901240";

function createTestOwnershipChecker() {
  const owners = new Map<string, string>([
    [`sensor:${sensorId}`, ownerId],
    [`talhao:${plotId}`, ownerId],
  ]);
  const blocked: Array<Record<string, string>> = [];
  const adminAccess: Array<Record<string, string>> = [];
  const logger: OwnershipLogger = {
    blocked: (entry) => blocked.push(entry),
    adminAccess: (entry) => adminAccess.push(entry),
  };
  const checker = createOwnershipChecker({
    async findOwnerId(resource: OwnedResource, resourceId: string) {
      return owners.get(`${resource}:${resourceId}`) ?? null;
    },
  }, logger);
  return { checker, blocked, adminAccess };
}

describe("verificacao de propriedade", () => {
  it("permite ao dono acessar sensor e talhao proprios", async () => {
    const { checker } = createTestOwnershipChecker();
    const user = { id: ownerId, role: "PRODUTOR_EXPORTADOR" as const };

    await checker(user, "sensor", sensorId, "127.0.0.1");
    await checker(user, "talhao", plotId, "127.0.0.1");
  });

  it("retorna o mesmo 404 para recurso de terceiro e recurso inexistente", async () => {
    const { checker, blocked } = createTestOwnershipChecker();
    const attacker = { id: "64a1b2c3-d4e5-4789-a012-345678901241", role: "PRODUTOR_EXPORTADOR" as const };
    const results: Array<{ statusCode: number; message: string }> = [];

    for (const id of [sensorId, "64a1b2c3-d4e5-4789-a012-345678901236"]) {
      try {
        await checker(attacker, "sensor", id, "127.0.0.2");
        assert.fail("O recurso deveria ser negado");
      } catch (error) {
        assert.ok(error instanceof ResourceNotFoundError);
        results.push({ statusCode: error.statusCode, message: error.message });
      }
    }

    assert.deepEqual(results[0], results[1]);
    assert.equal(blocked.length, 2);
  });

  it("permite acesso administrativo e registra o acesso", async () => {
    const { checker, adminAccess } = createTestOwnershipChecker();

    await checker({ id: "64a1b2c3-d4e5-4789-a012-345678901242", role: "ADMIN" }, "sensor", sensorId, "127.0.0.3");

    assert.equal(adminAccess.length, 1);
    assert.equal(adminAccess[0].resource, `sensor:${sensorId}`);
  });

  it("aceita UUID e rejeita IDs antigos ou malformados", () => {
    assert.equal(idSchema.safeParse(sensorId).success, true);
    assert.equal(idSchema.safeParse("64a1b2c3d4e5f67890123456").success, false);
    assert.equal(idSchema.safeParse("64a1b2c3-d4e5-f678-9012-345678901234").success, false);
    assert.equal(idSchema.safeParse("not-an-id").success, false);
  });
});
