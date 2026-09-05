import { analyzeSystem } from "./analyzer.js";
import { remediate } from "./remediator.js";

const INTERVAL_MS = Number(
    process.env.MONITOR_INTERVAL_MS || 15000
);

let running = false;

export async function runMonitorCycle() {
    if (running) {
        console.log(
            "[AI MONITOR] Previous cycle still running"
        );
        return;
    }

    running = true;

    try {
        const analysis = await analyzeSystem();

        console.log(
            `\n[AI MONITOR] ${analysis.timestamp}`
        );

        for (const item of analysis.pods) {
            console.log(
                `[AI MONITOR] ` +
                `pod=${item.pod} ` +
                `cpu=${item.cpu}% ` +
                `ready=${item.ready} ` +
                `restarts=${item.restartCount} ` +
                `newRestarts=${item.newRestarts} ` +
                `errorRate=${item.errorRate}% ` +
                `score=${item.incident.score} ` +
                `severity=${item.incident.severity} ` +
                `action=${item.decision.action}`
            );

            if (item.decision.action === "RESTART") {
                console.log(
                    `[AI MONITOR] Remediation requested for ${item.pod}`
                );

                const result = await remediate(
                    item.pod,
                    "RESTART"
                );

                console.log(
                    "[AI MONITOR] Remediation result:",
                    result
                );
            }
        }
    } catch (error) {
        console.error(
            "[AI MONITOR] Error:",
            error.message
        );
    } finally {
        running = false;
    }
}

export function startMonitor() {
    console.log(
        `[AI MONITOR] Started. ` +
        `Interval=${INTERVAL_MS / 1000}s`
    );

    runMonitorCycle();

    setInterval(
        runMonitorCycle,
        INTERVAL_MS
    );
}
startMonitor();