import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3333";
const tokenA = process.env.TOKEN_PRODUTOR_A;
const sensorA = process.env.SENSOR_A_ID;
const sensorB = process.env.SENSOR_B_ID;
const talhaoB = process.env.TALHAO_B_ID;

if (!tokenA || !sensorA || !sensorB || !talhaoB) {
  throw new Error("Defina TOKEN_PRODUTOR_A, SENSOR_A_ID, SENSOR_B_ID e TALHAO_B_ID.");
}

async function request(path, method = "GET", body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${tokenA}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

export async function runIdorChecks(mode) {
  const after = mode === "depois";
  const ownRead = await request(`/api/weather-data?sensorId=${encodeURIComponent(sensorA)}`);
  assert.equal(ownRead.status, 200, "O dono deve conseguir consultar as proprias leituras.");

  const foreignRead = await request(`/api/weather-data?sensorId=${encodeURIComponent(sensorB)}`);
  assert.equal(foreignRead.status, after ? 404 : 200);
  if (!after) {
    assert.equal(foreignRead.payload?.data?.length, 0,
      "No estado anterior, o filtro de produtor deve ocultar leituras de terceiros.");
  }

  const ownStatus = await request(`/api/sensors/${encodeURIComponent(sensorA)}/status`, "PATCH", {
    status: "ATIVO",
  });
  assert.equal(ownStatus.status, after ? 200 : 403);

  const foreignStatus = await request(`/api/sensors/${encodeURIComponent(sensorB)}/status`, "PATCH", {
    status: "INATIVO",
  });
  assert.equal(foreignStatus.status, after ? 404 : 403);

  const foreignPlot = await request("/api/sensors", "POST", {
    talhaoId: talhaoB,
    identificador: `idor-prova-${Date.now()}`,
  });
  assert.equal(foreignPlot.status, after ? 404 : 403);

  const ownCommand = await request(`/api/sensors/${encodeURIComponent(sensorA)}/comandos`, "POST", {
    comando: "LIGAR",
  });
  assert.equal(ownCommand.status, after ? 200 : 404);

  const foreignCommand = await request(`/api/sensors/${encodeURIComponent(sensorB)}/comandos`, "POST", {
    comando: "DESLIGAR",
  });
  assert.equal(foreignCommand.status, 404);

  for (const [test, result] of [
    ["leitura propria", ownRead],
    ["leitura de terceiro", foreignRead],
    ["alteracao propria", ownStatus],
    ["alteracao de terceiro", foreignStatus],
    ["criacao em talhao de terceiro", foreignPlot],
    ["comando proprio", ownCommand],
    ["comando em dispositivo de terceiro", foreignCommand],
  ]) {
    console.log(`${test}: HTTP ${result.status}`);
  }
}
