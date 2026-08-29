import request from "supertest";
import app from "../src/app.js";

describe("Self-Healing Node.js Application", () => {

  test("GET / should return application information", async () => {
    const response = await request(app)
      .get("/");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("running");
  });

  test("GET /health should return healthy", async () => {
    const response = await request(app)
      .get("/health");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("healthy");
  });

  test("GET /ready should return ready", async () => {
    const response = await request(app)
      .get("/ready");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("ready");
  });

  test("GET /api/status should return operational", async () => {
    const response = await request(app)
      .get("/api/status");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("operational");
  });

  test("GET /fault/error should simulate failure", async () => {
    const response = await request(app)
      .get("/fault/error");

    expect(response.statusCode).toBe(500);
  });

});