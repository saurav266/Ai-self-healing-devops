import express from "express";

import {
  client,
  httpRequestsTotal,
  httpRequestDuration,
  applicationErrorsTotal
} from "./metrics.js";

const app = express();

app.use(express.json());

/*
 * HTTP metrics middleware
 */
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);

    const duration =
      diff[0] + diff[1] / 1e9;

    const route = req.route?.path || req.path;

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode
    });

    httpRequestDuration.observe(
      {
        method: req.method,
        route,
        status_code: res.statusCode
      },
      duration
    );
  });

  next();
});

/*
 * Home
 */
app.get("/", (req, res) => {
  res.json({
    application: "AI-Driven Self-Healing DevOps",
    version: "1.0.0",
    status: "running"
  });
});

/*
 * Kubernetes liveness check
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy"
  });
});

/*
 * Kubernetes readiness check
 */
app.get("/ready", (req, res) => {
  res.status(200).json({
    status: "ready"
  });
});

/*
 * Prometheus metrics
 */
app.get("/metrics", async (req, res) => {
  res.set(
    "Content-Type",
    client.register.contentType
  );

  res.end(
    await client.register.metrics()
  );
});

/*
 * Application status
 */
app.get("/api/status", (req, res) => {
  res.json({
    service: "self-healing-api",
    status: "operational",
    timestamp: new Date().toISOString()
  });
});

/*
 * Fault injection:
 * Application error
 */
app.get("/fault/error", (req, res) => {
  applicationErrorsTotal.inc();

  res.status(500).json({
    error: "Simulated application failure"
  });
});

/*
 * Fault injection:
 * CPU stress
 */
app.get("/fault/cpu", (req, res) => {
  const seconds = Math.min(
    Number(req.query.seconds) || 10,
    60
  );

  const end = Date.now() + seconds * 1000;

  while (Date.now() < end) {
    Math.sqrt(
      Math.random() * Math.random()
    );
  }

  res.json({
    message: "CPU stress completed",
    duration_seconds: seconds
  });
});

/*
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

/*
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error(err);

  applicationErrorsTotal.inc();

  res.status(500).json({
    error: "Internal server error"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Self-Healing Node.js application running on port ${PORT}`
  );
});

export default app;