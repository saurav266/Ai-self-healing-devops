const CPU_THRESHOLD = Number(process.env.CPU_THRESHOLD || 80);

export function detectCpuAnomaly(results) {
    return results.map((item) => {
        const pod = item.metric?.pod || "unknown";
        const cpu = Number(item.value?.[1] || 0);

        const anomaly = cpu >= CPU_THRESHOLD;

        return {
            pod,
            cpu: Number(cpu.toFixed(2)),
            threshold: CPU_THRESHOLD,
            anomaly,
            status: anomaly ? "ANOMALY" : "NORMAL"
        };
    });
}