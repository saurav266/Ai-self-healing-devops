import express from "express";
import { detectCpuAnomaly } from "./detector.js";
import { queryPrometheus } from "./prometheus.js";
import { getNewRestartCount, clearPodState } from "./state.js";
import { calculateIncidentScore } from "./incidentScore.js";
import {
    getPodHealth,
    getHpaStatus,
    restartPod
} from "./kubernetes.js";
import { makeDecision } from "./decision.js";
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.json({
        service: "AI Self-Healing Engine",
        status: "running"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "healthy"
    });
});
app.get("/detect/cpu", async (req, res) => {
    try {
        const query = `
            100 *
            sum(
                rate(
                    self_healing_process_cpu_user_seconds_total{
                        job="self-healing-node-service"
                    }[5m]
                )
            ) by (pod)
        `;

        const result = await queryPrometheus(query);

        const analysis = detectCpuAnomaly(result);

        const anomalies = analysis.filter(
            (item) => item.anomaly
        );

        res.json({
            metric: "cpu",
            threshold: Number(process.env.CPU_THRESHOLD || 80),
            pods: analysis,
            anomalyDetected: anomalies.length > 0,
            anomalyCount: anomalies.length
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

app.get("/metrics/cpu", async (req, res) => {
    try {
        const query = `
            100 *
            sum(
                rate(
                    self_healing_process_cpu_user_seconds_total{
                        job="self-healing-node-service"
                    }[5m]
                )
            ) by (pod)
        `;

        const result = await queryPrometheus(query);

        res.json({
            metric: "cpu",
            result
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.get("/context", async (req, res) => {
    try {
        const [pods, hpa] = await Promise.all([
            getPodHealth(),
            getHpaStatus()
        ]);

        res.json({
            timestamp: new Date().toISOString(),
            kubernetes: {
                namespace: "self-healing",
                deployment: "self-healing-node-app"
            },
            pods,
            hpa
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.get("/analyze", async (req, res) => {
    try {
        const cpuQuery = `
            100 *
            sum(
                rate(
                    self_healing_process_cpu_user_seconds_total{
                        job="self-healing-node-service"
                    }[5m]
                )
            ) by (pod)
        `;

        const [cpuResults, pods, hpa] = await Promise.all([
            queryPrometheus(cpuQuery),
            getPodHealth(),
            getHpaStatus()
        ]);

        const analysis = cpuResults.map((item) => {
            const podName = item.metric?.pod || "unknown";

            const cpu = Number(item.value?.[1] || 0);

            const pod = pods.find(
                (p) => p.pod === podName
            );
            clearPodState(pods.map((pod) => pod.pod));
            const restartCount = pod?.restartCount || 0;

            const newRestarts = getNewRestartCount(
                podName,
                restartCount
            );
            const incident = calculateIncidentScore({
                cpu,
                newRestarts,
                podReady: pod?.ready ?? false,
                hpaCurrentReplicas: hpa.currentReplicas,
                hpaDesiredReplicas: hpa.desiredReplicas,
                hpaMaxReplicas: hpa.maxReplicas
            });

            const decision = makeDecision({
                cpu,
                restartCount,
                newRestarts,
                hpaCurrentReplicas: hpa.currentReplicas,
                hpaDesiredReplicas: hpa.desiredReplicas,
                hpaMaxReplicas: hpa.maxReplicas,
                podReady: pod?.ready ?? false
            });
          return {
            pod: podName,
            cpu: Number(cpu.toFixed(2)),
            ready: pod?.ready ?? false,
            restartCount,
            newRestarts,
            incident,
            decision
        };
        });

        res.json({
            timestamp: new Date().toISOString(),
            hpa,
            pods: analysis
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.post("/remediate", async (req, res) => {
    try {
        const { pod, action } = req.body;

        if (!pod) {
            return res.status(400).json({
                error: "pod is required"
            });
        }

        if (action !== "RESTART") {
            return res.status(400).json({
                error: "Only RESTART remediation is currently allowed"
            });
        }

        const pods = await getPodHealth();

        const targetPod = pods.find(
            (item) => item.pod === pod
        );

        if (!targetPod) {
            return res.status(404).json({
                error: "Pod not found"
            });
        }

        if (targetPod.ready && targetPod.restartCount < 2) {
            return res.status(409).json({
                error: "Pod does not meet restart safety criteria",
                pod: targetPod
            });
        }

        const result = await restartPod(pod);

        res.json({
            message: "Self-healing remediation executed",
            result
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.listen(PORT, () => {
    console.log(`AI Engine running on port ${PORT}`);
});