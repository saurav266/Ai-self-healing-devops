const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";

export async function queryPrometheus(query) {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Prometheus returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== "success") {
        throw new Error("Prometheus query failed");
    }

    return data.data.result;
}