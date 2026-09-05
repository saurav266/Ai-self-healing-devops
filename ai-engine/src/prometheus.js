const PROMETHEUS_URL =
    process.env.PROMETHEUS_URL || "http://localhost:9090";

export async function queryPrometheus(query) {
    const url =
        `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Prometheus returned HTTP ${response.status}`
        );
    }

    const data = await response.json();

    if (data.status !== "success") {
        throw new Error("Prometheus query failed");
    }

    return data.data.result;
}

/*
 * Calculate HTTP 5xx error rate
 */
export async function getHttpErrorRate() {
    const query = `
        100 *
        (
            sum(rate(http_requests_total{status_code=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
        )
    `;

    const result = await queryPrometheus(query);

    if (!result.length) {
        return 0;
    }

    return Number(result[0].value?.[1] || 0);
}