import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();

// Load ~/.kube/config
kc.loadFromDefault();

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const autoscalingApi = kc.makeApiClient(k8s.AutoscalingV2Api);

const NAMESPACE = process.env.K8S_NAMESPACE || "self-healing";
const DEPLOYMENT = process.env.K8S_DEPLOYMENT || "self-healing-node-app";

export async function getPodHealth() {
    const response = await coreApi.listNamespacedPod({
        namespace: NAMESPACE,
        labelSelector: `app=${DEPLOYMENT}`
    });

    return response.items.map((pod) => {
        const containerStatuses = pod.status?.containerStatuses || [];

        const restartCount = containerStatuses.reduce(
            (total, container) => total + (container.restartCount || 0),
            0
        );

        const ready = containerStatuses.some(
            (container) => container.ready === true
        );

        return {
            pod: pod.metadata?.name,
            ready,
            restartCount,
            phase: pod.status?.phase || "Unknown"
        };
    });
}

export async function getHpaStatus() {
    const response = await autoscalingApi.readNamespacedHorizontalPodAutoscaler({
        name: "self-healing-node-hpa",
        namespace: NAMESPACE
    });

    const hpa = response;

    return {
        currentReplicas: hpa.status?.currentReplicas || 0,
        desiredReplicas: hpa.status?.desiredReplicas || 0,
        maxReplicas: hpa.spec?.maxReplicas || 0,
        minReplicas: hpa.spec?.minReplicas || 0
    };
}
export async function restartPod(podName) {
    if (!podName) {
        throw new Error("Pod name is required");
    }

    await coreApi.deleteNamespacedPod({
        name: podName,
        namespace: NAMESPACE
    });

    return {
        pod: podName,
        action: "RESTART",
        status: "DELETE_REQUESTED"
    };
}